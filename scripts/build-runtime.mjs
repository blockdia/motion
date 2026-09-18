import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, readdir, access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { adapterVersion } from '../packages/authoring/dist/bundle-schema.js';
const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] || `artifacts/runtime/${adapterVersion}`);
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let shellBuild;
try {
  shellBuild = JSON.parse(await readFile(resolve(root, 'artifacts/shell/build.json'), 'utf8'));
} catch {}
if (
  shellBuild?.gui !== 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff' ||
  shellBuild?.extractionSha256 !== hash(await readFile(resolve(root, 'scripts/build-shell.mjs')))
)
  execFileSync(process.execPath, [resolve(root, 'scripts/build-shell.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
const blocksBuild = JSON.parse(
  await readFile(resolve(root, '.cache/turbowarp/build.json'), 'utf8'),
);
if (blocksBuild.commit !== '7c58de666658df1bb447d010132aa3914c10f41e')
  throw Error('Unexpected Blockly build');
for (const [file, digest] of Object.entries(blocksBuild.files))
  if (hash(await readFile(resolve(root, '.cache/turbowarp', file))) !== digest)
    throw Error('Blockly build hash mismatch: ' + file);
const catalogBuild = JSON.parse(await readFile(resolve(root, '.cache/catalog/build.json'), 'utf8'));
if (
  catalogBuild.gui !== 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff' ||
  hash(await readFile(resolve(root, '.cache/catalog/editor.js'))) !== catalogBuild.bundleSha256
)
  throw Error('Catalog build hash mismatch');
const scripts = [
  'blockly_compressed_vertical.js',
  'blocks_compressed.js',
  'blocks_compressed_vertical.js',
  'msg/messages.js',
  'msg/scratch_msgs.js',
];
for (const file of scripts) {
  await mkdir(resolve(output, file, '..'), { recursive: true });
  await cp(resolve(root, '.cache/turbowarp', file), resolve(output, file));
}
await cp(resolve(root, '.cache/turbowarp/media'), resolve(output, 'media'), { recursive: true });
await cp(resolve(root, '.cache/catalog/editor.js'), resolve(output, 'editor.js'));
await cp(resolve(root, 'packages/asset-builder/prepare.js'), resolve(output, 'prepare.js'));
await cp(resolve(root, 'packages/renderer-browser/loading.css'), resolve(output, 'loading.css'));
await cp(resolve(root, 'packages/renderer-browser/loading'), resolve(output, 'loading'), {
  recursive: true,
});
await cp(
  resolve(root, 'packages/asset-builder/runtime-entry.js'),
  resolve(output, 'runtime-entry.js'),
);
const packages = ['core', 'authoring', 'adapter-turbowarp', 'asset-builder', 'renderer-browser'];
const hashes = {};
for (const name of packages) {
  const dir = resolve(output, 'modules', name);
  await mkdir(dir, { recursive: true });
  for (const file of await readdir(resolve(root, 'packages', name, 'dist'))) {
    if (!file.endsWith('.js')) continue;
    if (
      (name === 'authoring' && ['typing.js', 'bundle.js', 'index.js'].includes(file)) ||
      (name === 'asset-builder' && file === 'index.js')
    ) {
      await rm(resolve(dir, file), { force: true });
      continue;
    }
    try {
      await access(resolve(root, 'packages', name, 'src', file.replace(/\.js$/, '.ts')));
    } catch {
      await rm(resolve(dir, file), { force: true });
      continue;
    }
    let code = await readFile(resolve(root, 'packages', name, 'dist', file), 'utf8');
    code = code.replace(
      /(['"])@blockdia-motion\/([a-z-]+)(?:\/([a-z-]+))?\1/g,
      (_, q, p, sub) => `${q}../${p}/${sub || 'index'}.js${q}`,
    );
    await writeFile(resolve(dir, file), code);
    hashes[`modules/${name}/${file}`] = createHash('sha256').update(code).digest('hex');
  }
}
await writeFile(
  resolve(output, 'prepare.html'),
  `<!doctype html><meta charset="utf-8"><div id="workspace" style="width:1200px;height:900px"></div>${[...scripts, 'editor.js', 'prepare.js'].map((s) => `<script src="./${s}"></script>`).join('')}<script type="module" src="./runtime-entry.js"></script>`,
);
await writeFile(
  resolve(output, 'player.html'),
  `<!doctype html><meta charset="utf-8"><style>body{margin:0}#player{width:1280px}</style><div id="player"></div><script type="module">import {mountPlayer} from './modules/renderer-browser/index.js';window.mountTutorial=async(bundle,options={})=>{window.player?.dispose?.();const player=window.player=mountPlayer(document.getElementById('player'),bundle,{runtimeUrl:new URL('./',location.href).href,...options});await player.ready;return player;};</script>`,
);
await writeFile(
  resolve(output, 'embed.html'),
  (await readFile(resolve(root, 'apps/player/index.html'), 'utf8'))
    .replace(`content="/artifacts/runtime/${adapterVersion}/"`, 'content="./"')
    .replaceAll('/packages/renderer-browser/', './'),
);

for (const locale of ['zh-CN', 'en'])
  for (const theme of ['light', 'dark'])
    await cp(
      resolve(root, `artifacts/shell/shell.${locale}.${theme}.json`),
      resolve(output, `shell.${locale}.${theme}.json`),
    );

await cp(resolve(root, 'THIRD_PARTY_NOTICES.md'), resolve(output, 'THIRD_PARTY_NOTICES.md'));
await cp(resolve(root, 'licenses'), resolve(output, 'licenses'), { recursive: true });

async function inventory(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const key = prefix + entry.name;
    if (entry.isDirectory()) await inventory(resolve(dir, entry.name), key + '/');
    else if (key !== 'manifest.json') hashes[key] = hash(await readFile(resolve(dir, entry.name)));
  }
}
await inventory(output);
await writeFile(
  resolve(output, 'manifest.json'),
  JSON.stringify({ version: adapterVersion, files: hashes }, null, 2),
);
console.log(output);
