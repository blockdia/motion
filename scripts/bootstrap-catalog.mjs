import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const sourceCheckout = resolve(process.env.TURBOWARP_GUI || '../scratch-gui');
const require = createRequire(root + '/.cache/gui/package.json');
const webpack = require('webpack');
const reference = JSON.parse(await readFile(root + '/.cache/gui/reference-build.json', 'utf8'));
if (reference.commit !== 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff')
  throw Error('Unexpected GUI source');
if (
  createHash('sha256')
    .update(await readFile(root + '/.cache/gui/package-lock.json'))
    .digest('hex') !== reference.lockSha256
)
  throw Error('GUI lockfile changed; rebuild the pinned reference');
await mkdir(root + '/.cache/catalog', { recursive: true });
const stats = await new Promise((resolve, reject) =>
  webpack(
    {
      mode: 'development',
      devtool: false,
      context: root,
      entry: './packages/asset-builder/editor-entry.js',
      output: { path: root + '/.cache/catalog', filename: 'editor.js' },
      resolve: {
        alias: { './tw-lazy-scratch-blocks': root + '/packages/asset-builder/blocks-global.js' },
        modules: [root + '/.cache/gui/node_modules', 'node_modules'],
      },
      node: { fs: 'empty' },
      module: {
        rules: [
          {
            test: /\.js$/,
            use: {
              loader: require.resolve('babel-loader'),
              options: {
                babelrc: false,
                configFile: false,
                presets: [require.resolve('@babel/preset-env')],
              },
            },
          },
          { test: /\.(svg|png|mp3|wav)$/, loader: require.resolve('url-loader') },
        ],
      },
    },
    (error, stats) => (error ? reject(error) : resolve(stats)),
  ),
);
if (stats.hasErrors()) throw Error(stats.toString({ all: false, errors: true }));
const hash = (x) => createHash('sha256').update(x).digest('hex');
const inputs = {};
for (const file of [...stats.compilation.fileDependencies].sort()) {
  if (file.startsWith(root + '/') && !file.includes('/.git/')) {
    try {
      const bytes = await readFile(file);
      if (file.startsWith(root + '/.cache/gui/src/')) {
        const original = execFileSync('git', [
          '-C',
          sourceCheckout,
          'show',
          reference.commit + ':' + file.slice((root + '/.cache/gui/').length),
        ]);
        if (hash(original) !== hash(bytes)) throw Error('Pinned GUI source changed: ' + file);
      }
      inputs[file.slice(root.length + 1)] = hash(bytes);
    } catch (e) {
      if (e.code !== 'EISDIR') throw e;
    }
  }
}
await writeFile(
  root + '/.cache/catalog/build.json',
  JSON.stringify(
    {
      gui: reference.commit,
      lockSha256: hash(await readFile(root + '/.cache/gui/package-lock.json')),
      bundleSha256: hash(await readFile(root + '/.cache/catalog/editor.js')),
      inputs,
    },
    null,
    2,
  ),
);
console.log('Built pinned GUI toolbox and VM data-model bridge');
