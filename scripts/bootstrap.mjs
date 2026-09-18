import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './server.mjs';
const commit = '7c58de666658df1bb447d010132aa3914c10f41e';
const checkout = resolve(process.env.TURBOWARP_BLOCKS || root + '/../scratch-blocks');
const dest = root + '/.cache/turbowarp';
// Build an immutable git snapshot; never alter the supplied checkout.
const archive = execFileSync('git', ['-C', checkout, 'archive', commit], {
  maxBuffer: 64 * 1024 * 1024,
});
await mkdir(dest, { recursive: true });
const unpack = spawnSync('tar', ['-x', '-C', dest], { input: archive });
if (unpack.status !== 0) throw Error(String(unpack.stderr));
await rm(dest + '/node_modules', { force: true, recursive: true });
await symlink(checkout + '/node_modules', dest + '/node_modules', 'dir');
execFileSync('python3', ['build.py'], {
  cwd: dest,
  env: {
    ...process.env,
    PATH: dest + '/node_modules/.bin:' + process.env.PATH,
  },
  stdio: 'inherit',
});
const files = {};
for (const file of [
  'blockly_compressed_vertical.js',
  'blocks_compressed.js',
  'blocks_compressed_vertical.js',
  'msg/messages.js',
  'msg/scratch_msgs.js',
])
  files[file] = createHash('sha256')
    .update(await readFile(dest + '/' + file))
    .digest('hex');
await writeFile(dest + '/build.json', JSON.stringify({ commit, files }, null, 2));
console.log(`Prepared TurboWarp scratch-blocks ${commit}`);
