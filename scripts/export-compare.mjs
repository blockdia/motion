// Paired cold exports: identical semantic bundle/font/encoder, no concurrent benchmark jobs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, platform, arch, release } from 'node:os';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import { exportVideo } from '../packages/renderer-video/dist/index.js';
import basic from '../examples/basic-editing/tutorial.ts';
import all from '../examples/all-api/tutorial.ts';
const font = process.argv[2];
if (!font) throw Error('Pass an explicit benchmark font path');
const quick = process.argv.includes('--quick');
const repeatOnly = process.argv.includes('--repeat-only');
const engines = ['screenshot', 'composite'];
const out = 'artifacts/export-comparison';
await mkdir(out, { recursive: true });
const controller = new AbortController();
const cancel = () => controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
const long = {
  ...all,
  steps: Array.from({ length: 5 }, (_, i) => [
    ...JSON.parse(JSON.stringify(all.steps), (k, v) =>
      k === 'id' && typeof v === 'string' && !['stage', 'sprite'].includes(v)
        ? `lesson${i}.${v}`
        : v,
    ),
    { op: 'wait', duration: 10 },
  ]).flat(),
};
const cases = repeatOnly
  ? []
  : [
      { name: 'basic-720-30', spec: basic, width: 1280, height: 720, fps: 30 },
      { name: 'basic-1080-30', spec: basic, width: 1920, height: 1080, fps: 30 },
      { name: 'all-api-720-30', spec: all, width: 1280, height: 720, fps: 30 },
      ...(quick ? [] : [{ name: 'long-720-15', spec: long, width: 1280, height: 720, fps: 15 }]),
    ];
const sourcePaths = [
  'packages/renderer-video/src/index.ts',
  'packages/renderer-video/src/compositor.ts',
  'packages/renderer-video/src/bitmap.ts',
  'packages/renderer-video/src/memory.ts',
  'packages/renderer-browser/src/export.ts',
  'scripts/export-compare.mjs',
];
const hash = (b) => createHash('sha256').update(b).digest('hex');
const report = repeatOnly
  ? JSON.parse(await readFile(`${out}/report.json`, 'utf8'))
  : {
      environment: {
        node: process.version,
        platform: platform(),
        arch: arch(),
        release: release(),
        cpu: cpus()[0]?.model,
        canvasVersion: JSON.parse(
          await readFile(
            'packages/renderer-video/node_modules/@napi-rs/canvas/package.json',
            'utf8',
          ),
        ).version,
        ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
        fontSha256: hash(await readFile(font)),
        sources: Object.fromEntries(
          await Promise.all(sourcePaths.map(async (p) => [p, hash(await readFile(p))])),
        ),
      },
      quick,
      cases: [],
    };
function decode(file, frame) {
  return execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${frame})`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: 32 * 1024 ** 2 },
  );
}
function compare(a, b) {
  if (a.length !== b.length) throw Error('Decoded frame sizes differ');
  let sum = 0,
    changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    let max = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sum += d;
      max = Math.max(max, d);
    }
    if (max > 32) changed++;
  }
  return { mean: sum / a.length, changed: changed / (a.length / 3) };
}
for (const { name, spec, ...options } of cases) {
  const bundle = await bundleTutorial(spec);
  await writeFile(`${out}/${name}.json`, JSON.stringify(bundle));
  const results = {};
  for (const backend of engines) {
    console.log(`Starting ${name}/${backend}`);
    let last = performance.now();
    const result = await exportVideo(bundle, {
      ...options,
      backend: backend === 'screenshot' ? 'screenshot' : 'composite',
      output: `${out}/${name}-${backend}.mp4`,
      font,
      concurrency: 1,
      cacheBytes: 32 * 1024 ** 2,
      encoderThreads: 2,
      signal: controller.signal,
      onProgress: (p) => {
        if (performance.now() - last > 20000) {
          console.log(`${name}/${backend}: ${p.completed}/${p.frames}`);
          last = performance.now();
        }
      },
    });
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'quiet',
          '-count_frames',
          '-show_streams',
          '-of',
          'json',
          `${out}/${name}-${backend}.mp4`,
        ],
        { encoding: 'utf8' },
      ),
    );
    const stream = probe.streams[0];
    if (
      probe.streams.length !== 1 ||
      stream.width !== result.width ||
      stream.height !== result.height ||
      Number(stream.nb_read_frames) !== result.frames
    )
      throw Error('Invalid output dimensions/frame count');
    results[backend] = {
      ...result,
      probe: { frames: Number(stream.nb_read_frames), duration: Number(stream.duration) },
    };
    console.log(
      `${name}/${backend}: ${(result.exportMs / 1000).toFixed(2)}s, tree ${(result.memory.processTreePeakRssBytes / 1024 ** 3).toFixed(2)} GiB`,
    );
  }
  const s = results[engines[0]],
    c = results[engines[1]];
  if (s.frames !== c.frames) throw Error('Backends produced different frame counts');
  // Uniform samples include motion, static tails and repeated lesson boundaries.
  const frames = [
    ...new Set(Array.from({ length: 9 }, (_, i) => Math.round((i * (s.frames - 1)) / 8))),
  ];
  const quality = frames.map((frame) => ({
    frame,
    time: frame / options.fps,
    ...compare(
      decode(`${out}/${name}-${engines[0]}.mp4`, frame),
      decode(`${out}/${name}-${engines[1]}.mp4`, frame),
    ),
  }));
  const qualityPassed = quality.every((q) => q.mean <= 3 && q.changed <= 0.025);
  const budgetPassed = [s, c].every(
    (r) =>
      r.memory.processTreeAvailable &&
      r.memory.processTreePeakRssBytes <= 2.5 * 1024 ** 3 &&
      r.preparationMs <= 30000 &&
      (r.height !== 720 || r.compositionMs / r.frames <= 110),
  );
  report.cases.push({
    name,
    ...results,
    quality,
    qualityPassed,
    budgetPassed,
    exportSpeedup: s.exportMs / c.exportMs,
    compositionSpeedup: s.compositionMs / c.compositionMs,
    totalTimeReduction: 1 - c.exportMs / s.exportMs,
  });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (!qualityPassed || !budgetPassed)
    throw Error(`${name} visual/budget comparison failed; see report.json`);
}
if (!quick) {
  const first = report.cases.find((c) => c.name === 'long-720-15')?.[engines[1]];
  if (!first) throw Error('Run the full paired comparison before --repeat-only');
  const bundle = JSON.parse(await readFile(`${out}/long-720-15.json`, 'utf8'));
  let previous = first;
  for (let run = 0; run < (repeatOnly ? 2 : 1); run++) {
    const output = `${out}/long-720-15-${engines[1]}-repeat-${run}.mp4`;
    console.log(`Starting long-720-15/${engines[1]}-repeat-${run}`);
    let last = performance.now();
    const result = await exportVideo(bundle, {
      output,
      font,
      backend: 'composite',
      width: first.width,
      height: first.height,
      fps: first.fps,
      concurrency: 1,
      cacheBytes: 32 * 1024 ** 2,
      encoderThreads: 2,
      signal: controller.signal,
      onProgress: (p) => {
        if (performance.now() - last > 20000) {
          console.log(`composite-repeat: ${p.completed}/${p.frames}`);
          last = performance.now();
        }
      },
    });
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'quiet', '-count_frames', '-show_streams', '-of', 'json', output],
        { encoding: 'utf8' },
      ),
    );
    if (
      probe.streams.length !== 1 ||
      Number(probe.streams[0].nb_read_frames) !== result.frames ||
      probe.streams[0].width !== result.width ||
      probe.streams[0].height !== result.height
    )
      throw Error('Repeated output failed frame/dimension validation');
    const frames = [0, Math.floor(first.frames / 2), first.frames - 1];
    const digest = (file) =>
      hash(
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-i',
          file,
          '-vf',
          frames
            .map((n) => `eq(n\\,${n})`)
            .join('+')
            .replace(/^/, 'select='),
          '-f',
          'framemd5',
          'pipe:1',
        ]),
      );
    const peakGrowthBytes =
      result.memory.processTreePeakRssBytes - previous.memory.processTreePeakRssBytes;
    const repeatPassed =
      result.frames === first.frames &&
      digest(`${out}/long-720-15-${engines[1]}.mp4`) === digest(output) &&
      result.memory.processTreeAvailable &&
      result.memory.processTreePeakRssBytes <= 2.5 * 1024 ** 3 &&
      result.preparationMs <= 30000 &&
      result.compositionMs / result.frames <= 110 &&
      peakGrowthBytes <= 512 * 1024 ** 2;
    if (repeatOnly && run === 0) report.longRepeatBaseline = result;
    report.longRepeat = {
      ...result,
      peakGrowthBytes,
      repeatPassed,
      sources: Object.fromEntries(
        await Promise.all(sourcePaths.map(async (p) => [p, hash(await readFile(p))])),
      ),
    };
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    if (!repeatPassed) throw Error('Repeated composite export failed determinism/memory budget');
    console.log(
      `composite-repeat: ${(result.exportMs / 1000).toFixed(2)}s, tree ${(result.memory.processTreePeakRssBytes / 1024 ** 3).toFixed(2)} GiB`,
    );
    previous = result;
  }
}
process.removeListener('SIGINT', cancel);
process.removeListener('SIGTERM', cancel);
