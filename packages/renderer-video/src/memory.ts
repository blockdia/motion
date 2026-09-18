import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
/** Sample the entire export process tree. RSS includes shared pages counted per process. */
export function monitorMemory() {
  const report = {
    sampleIntervalMs: 250,
    samples: 0,
    nodePeakRssBytes: process.memoryUsage().rss,
    browserPeakRssBytes: 0,
    encoderPeakRssBytes: 0,
    processTreePeakRssBytes: 0,
    processTreeAvailable: false,
  };
  let pending: Promise<void> | undefined;
  function sample() {
    if (pending) return pending;
    report.nodePeakRssBytes = Math.max(report.nodePeakRssBytes, process.memoryUsage().rss);
    pending = (async () => {
      try {
        const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,rss=,comm=']);
        const rows = stdout
          .trim()
          .split('\n')
          .map((line) => {
            const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
            return match
              ? {
                  pid: Number(match[1]),
                  parent: Number(match[2]),
                  rss: Number(match[3]) * 1024,
                  name: match[4]!,
                }
              : undefined;
          })
          .filter((row) => row !== undefined);
        const ids = new Set([process.pid]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const row of rows)
            if (ids.has(row.parent) && !ids.has(row.pid)) {
              ids.add(row.pid);
              changed = true;
            }
        }
        let total = 0,
          browser = 0,
          encoder = 0;
        for (const row of rows)
          if (ids.has(row.pid) && !/(?:^|\/)ps$/.test(row.name)) {
            total += row.rss;
            if (/chrome|chromium/i.test(row.name)) browser += row.rss;
            if (/ffmpeg/i.test(row.name)) encoder += row.rss;
          }
        report.processTreeAvailable = true;
        report.samples++;
        report.processTreePeakRssBytes = Math.max(report.processTreePeakRssBytes, total);
        report.browserPeakRssBytes = Math.max(report.browserPeakRssBytes, browser);
        report.encoderPeakRssBytes = Math.max(report.encoderPeakRssBytes, encoder);
      } catch {
        // Unsupported ps platforms still report Node RSS; never report missing tree data as zero usage.
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  const timer = setInterval(() => {
    void sample();
  }, report.sampleIntervalMs);
  timer.unref();
  void sample();
  let stopping: Promise<void> | undefined;
  return {
    report,
    stop() {
      // Success and finally both call stop; freeze metrics after the first final sample.
      return (stopping ??= (async () => {
        clearInterval(timer);
        await sample();
      })());
    },
  };
}
