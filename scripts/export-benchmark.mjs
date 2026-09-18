// Fixed-font, serial benchmark runs. Long runs contain repeated complete editing lessons, not only a static wait.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, platform, arch, release } from 'node:os';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import { exportVideo } from '../packages/renderer-video/dist/index.js';
import basic from '../examples/basic-editing/tutorial.ts';
import all from '../examples/all-api/tutorial.ts';
import { targetProject } from '../tests/fixtures/target-project.mjs';
const font = process.argv[2];
if (!font) throw Error('Pass an explicit benchmark font path');
const quick = process.argv.includes('--quick');
const out = 'artifacts/export-benchmark';
const controller = new AbortController();
const cancel = () => controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
await mkdir(out, { recursive: true });
function remap(value, prefix) {
  const ids = new Set();
  const collect = (v) => {
    if (v && typeof v === 'object') {
      if (typeof v.id === 'string' && !['stage', 'sprite'].includes(v.id)) ids.add(v.id);
      for (const child of Object.values(v)) collect(child);
    }
  };
  collect(value);
  return JSON.parse(JSON.stringify(value), (key, v) =>
    key === 'id' && typeof v === 'string' && ids.has(v) ? prefix + v : v,
  );
}
const long = {
  ...all,
  steps: Array.from({ length: 5 }, (_, i) => [
    ...remap(all.steps, `lesson${i}.`),
    { op: 'wait', duration: 10 },
  ]).flat(),
};
const stress = {
  ...all,
  project: targetProject(),
  steps: [
    ...Array.from({ length: 64 }, (_, i) => [
      {
        op: 'create',
        mode: 'direct',
        blocks: [
          {
            id: `extra${i}`,
            opcode: 'looks_say',
            inputs: {
              MESSAGE: {
                shadow: {
                  id: `text${i}`,
                  opcode: 'text',
                  fields: { TEXT: `长中文字段资源变体 ${i} ${'内容'.repeat(i % 12)}` },
                },
              },
            },
          },
        ],
        to: { kind: 'workspaceSlot', name: 'main' },
      },
      { op: 'delete', mode: 'direct', id: `extra${i}` },
    ]).flat(),
    ...all.steps,
  ],
};
const cases = [
  { name: 'basic-360-15', spec: basic, width: 640, height: 360, fps: 15 },
  { name: 'basic-720-30', spec: basic, width: 1280, height: 720, fps: 30 },
  { name: 'basic-1080-30', spec: basic, width: 1920, height: 1080, fps: 30 },
  { name: 'basic-720-30-c2', spec: basic, width: 1280, height: 720, fps: 30, concurrency: 2 },
  { name: 'resources-720-15', spec: stress, width: 1280, height: 720, fps: 15 },
  ...(quick
    ? []
    : [
        { name: 'long-720-15-a', spec: long, width: 1280, height: 720, fps: 15 },
        { name: 'long-720-15-b', spec: long, width: 1280, height: 720, fps: 15 },
      ]),
];
const report = {
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    release: release(),
    cpu: cpus()[0]?.model,
    ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
    fontSha256: createHash('sha256')
      .update(await readFile(font))
      .digest('hex'),
    sources: Object.fromEntries(
      await Promise.all(
        [
          'packages/renderer-video/src/index.ts',
          'packages/renderer-video/src/cache.ts',
          'packages/renderer-video/src/memory.ts',
          'scripts/export-benchmark.mjs',
        ].map(async (p) => [
          p,
          createHash('sha256')
            .update(await readFile(p))
            .digest('hex'),
        ]),
      ),
    ),
  },
  quick,
  budgets: {
    processTreePeakRssBytes: 2.5 * 1024 ** 3,
    preparationMs: 30000,
    compositionMsPerFrame720: 110,
    repeatPeakGrowthBytes: 512 * 1024 ** 2,
  },
  cases: [],
};
for (const { name, spec, ...options } of cases) {
  const output = `${out}/${name}.mp4`;
  const b = await bundleTutorial(spec);
  await writeFile(`${out}/${name}.json`, JSON.stringify(b));
  console.log(`Starting ${name}`);
  let last = performance.now();
  const result = await exportVideo(b, {
    output,
    font,
    backend: 'screenshot',
    signal: controller.signal,
    ...options,
    onProgress: (p) => {
      if (performance.now() - last > 30000) {
        console.log(`${name}: ${p.completed}/${p.frames}`);
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
  const stream = probe.streams[0];
  if (
    probe.streams.length !== 1 ||
    Number(stream.nb_read_frames) !== result.frames ||
    stream.width !== result.width ||
    stream.height !== result.height
  )
    throw Error('Output video failed frame/dimension validation');
  const budgetPassed =
    result.memory.processTreeAvailable &&
    result.memory.processTreePeakRssBytes <= report.budgets.processTreePeakRssBytes &&
    result.preparationMs <= report.budgets.preparationMs &&
    (result.height !== 720 ||
      result.compositionMs / result.frames <= report.budgets.compositionMsPerFrame720);
  const keyframeDigest = createHash('sha256')
    .update(
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-i',
        output,
        '-vf',
        `select=eq(n\\,0)+eq(n\\,${Math.floor(result.frames / 2)})+eq(n\\,${result.frames - 1})`,
        '-f',
        'framemd5',
        'pipe:1',
      ]),
    )
    .digest('hex');
  report.cases.push({
    name,
    budgetPassed,
    keyframeDigest,
    bundleBytes: Buffer.byteLength(JSON.stringify(b)),
    ...result,
    probe: {
      frames: Number(stream.nb_read_frames),
      width: stream.width,
      height: stream.height,
      duration: Number(stream.duration),
    },
    throughputFps: result.frames / (result.compositionMs / 1000),
  });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    `${name}: ${(result.exportMs / 1000).toFixed(2)}s, tree ${(result.memory.processTreePeakRssBytes / 1024 ** 3).toFixed(2)} GiB`,
  );
  if (!budgetPassed)
    throw Error(`${name} exceeds the fixed-environment budget; see ${out}/report.json`);
}
if (!quick) {
  const [a, b] = report.cases.slice(-2);
  report.longRepeatPassed =
    a.frames > 2700 &&
    a.frames === b.frames &&
    a.keyframeDigest === b.keyframeDigest &&
    b.memory.processTreePeakRssBytes - a.memory.processTreePeakRssBytes <=
      report.budgets.repeatPeakGrowthBytes;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (!report.longRepeatPassed) throw Error('Long repeat determinism/memory budget failed');
}
