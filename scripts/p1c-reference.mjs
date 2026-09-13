// Independent check against the complete, pinned GUI build, not the extraction bridge.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
import { createAdapter } from '../packages/asset-builder/dist/index.js';
import { targetProject } from '../tests/fixtures/target-project.mjs';
const project = targetProject(),
  root = resolve('.cache/gui/build'),
  out = resolve('docs/p1c-baseline');
const adapter = await createAdapter({ project });
const scene = { manifest: structuredClone(adapter.manifest) };
await adapter.dispose();
const require = createRequire(resolve('.cache/gui/package.json')),
  Zip = require('@turbowarp/jszip');
const zip = new Zip();
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z" fill="white"/></svg>',
);
const imageId = createHash('md5').update(svg).digest('hex');
zip.file(imageId + '.svg', svg);
const wav = Buffer.alloc(46);
wav.write('RIFF');
wav.writeUInt32LE(38, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(2, 40);
const soundId = createHash('md5').update(wav).digest('hex');
zip.file(soundId + '.wav', wav);
zip.file(
  'project.json',
  JSON.stringify({
    targets: project.targets.map((t) => {
      const blocks = {};
      for (const [i, v] of t.variables.filter((v) => v.type === 'broadcast_msg').entries())
        blocks['broadcast' + i] = {
          opcode: 'event_whenbroadcastreceived',
          next: null,
          parent: null,
          inputs: {},
          fields: { BROADCAST_OPTION: [v.name, v.id] },
          shadow: false,
          topLevel: true,
          x: 0,
          y: 100,
        };
      for (const [i, p] of t.procedures.entries()) {
        const id = 'definition' + i,
          proto = 'prototype' + i;
        blocks[id] = {
          opcode: 'procedures_definition',
          next: null,
          parent: null,
          inputs: { custom_block: [1, proto] },
          fields: {},
          shadow: false,
          topLevel: true,
          x: 0,
          y: 0,
        };
        blocks[proto] = {
          opcode: 'procedures_prototype',
          next: null,
          parent: id,
          inputs: {},
          fields: {},
          shadow: true,
          topLevel: false,
          mutation: {
            tagName: 'mutation',
            children: [],
            proccode: p.code,
            argumentids: JSON.stringify(p.argumentIds),
            argumentnames: JSON.stringify(p.argumentNames),
            argumentdefaults: JSON.stringify(p.argumentDefaults),
            warp: String(p.warp),
          },
        };
      }
      return {
        isStage: t.isStage,
        name: t.name,
        variables: Object.fromEntries(
          t.variables.filter((v) => v.type === '').map((v) => [v.id, [v.name, 0]]),
        ),
        lists: Object.fromEntries(
          t.variables.filter((v) => v.type === 'list').map((v) => [v.id, [v.name, []]]),
        ),
        broadcasts: Object.fromEntries(
          t.variables.filter((v) => v.type === 'broadcast_msg').map((v) => [v.id, v.name]),
        ),
        blocks,
        comments: {},
        currentCostume: 0,
        costumes: t.costumes.map((name) => ({
          name,
          assetId: imageId,
          md5ext: imageId + '.svg',
          dataFormat: 'svg',
          bitmapResolution: 1,
          rotationCenterX: 0,
          rotationCenterY: 0,
        })),
        sounds: t.sounds.map((name) => ({
          name,
          assetId: soundId,
          md5ext: soundId + '.wav',
          dataFormat: 'wav',
          rate: 8000,
          sampleCount: 1,
        })),
        volume: 100,
        layerOrder: t.isStage ? 0 : 1,
        visible: t.visible,
        x: t.x,
        y: t.y,
        size: t.size,
        direction: t.direction,
        draggable: false,
        rotationStyle: 'all around',
      };
    }),
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: 'Motion P1c reference' },
  }),
);
const bytes = await zip.generateAsync({ type: 'uint8array' });
const server = createServer(async (req, res) => {
  try {
    const p = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!p.startsWith(root + '/')) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[extname(p)] || 'application/octet-stream',
    );
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' });
  // Match the supported core menu configuration; retain P1a's visual addons.
  await page.addInitScript(() =>
    localStorage.setItem(
      'tw:addons',
      JSON.stringify({
        _: 5,
        'rename-broadcasts': { enabled: false },
        'editor-searchable-dropdowns': { enabled: false },
      }),
    ),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/editor.html?locale=zh-cn`);
  await page.waitForFunction(
    () => window.vm && window.ScratchBlocks?.getMainWorkspace(),
    {},
    { timeout: 120000 },
  );
  await page.evaluate(async (bytes) => {
    await vm.loadProject(new Uint8Array(bytes).buffer);
    vm.stopAll();
  }, Array.from(bytes));
  const report = [];
  for (const target of project.targets) {
    await page.evaluate((target) => {
      const t = vm.runtime.targets.find((t) =>
        target.isStage ? t.isStage : t.sprite.name === target.name,
      );
      vm.setEditingTarget(t.id);
    }, target);
    await page.waitForFunction(
      (target) =>
        (target.isStage
          ? vm.editingTarget.isStage
          : vm.editingTarget.sprite.name === target.name) &&
        ScratchBlocks.getMainWorkspace().getFlyout().getWorkspace().getTopBlocks(false).length > 50,
      target,
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await page.evaluate(() => vm.emitTargetsUpdate(false));
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    if (!target.isStage)
      await page.waitForFunction(
        (target) =>
          ScratchBlocks.getMainWorkspace()
            .getFlyout()
            .getWorkspace()
            .getBlockById('movex')
            ?.getFieldValue('NUM') === String(target.x),
        target,
      );
    const native = await page.evaluate(() => {
      const B = ScratchBlocks,
        ws = B.getMainWorkspace(),
        flyout = ws.getFlyout();
      function definition(b) {
        const d = { opcode: b.type, fields: {}, inputs: {}, options: {} };
        for (const input of b.inputList) {
          for (const f of input.fieldRow)
            if (f.name && f.SERIALIZABLE) {
              d.fields[f.name] = String(f.getValue());
              if (f instanceof B.FieldDropdown)
                d.options[f.name] = f
                  .getOptions()
                  .filter((o) => typeof o[1] !== 'function')
                  .map((o) => [typeof o[0] === 'string' ? o[0] : o[0].alt || '', String(o[1])]);
            }
          const child = input.connection?.targetBlock();
          if (child)
            d.inputs[input.name] = { [child.isShadow() ? 'shadow' : 'block']: definition(child) };
        }
        if (b.mutationToDom) {
          const m = b.mutationToDom();
          if (m) d.mutation = Object.fromEntries([...m.attributes].map((a) => [a.name, a.value]));
        }
        return d;
      }
      return {
        categories: flyout.categoryScrollPositions.map((c) => ({
          key: c.categoryId,
          label: B.utils.replaceMessageReferences(c.categoryName),
          scroll: c.position * ws.scale,
        })),
        entries: flyout
          .getWorkspace()
          .getTopBlocks(false)
          .sort((a, b) => a.getRelativeToSurfaceXY().y - b.getRelativeToSurfaceXY().y)
          .map((b) => ({ definition: definition(b), y: b.getRelativeToSurfaceXY().y * ws.scale })),
        buttons: flyout.buttons_.map((b) => B.utils.replaceMessageReferences(b.getText())),
      };
    });
    const expected = scene.manifest.targets[target.id];
    assert.deepEqual(
      native.categories.map((c) => [c.key, c.label, c.scroll]),
      expected.categories.map((c) => [c.key, c.label, c.scroll]),
    );
    assert.deepEqual(
      native.entries.map((e) => e.definition.opcode),
      expected.toolbox.map((e) => e.definition.opcode),
    );
    function comparable(d) {
      const fields = { ...d.fields };
      // The native GUI intentionally randomizes colour defaults; Motion records a seeded sample.
      if (d.opcode === 'colour_picker') delete fields.COLOUR;
      return {
        opcode: d.opcode,
        fields,
        inputs: Object.fromEntries(
          Object.entries(d.inputs ?? {}).map(([k, v]) => [
            k,
            Object.fromEntries(Object.entries(v).map(([kind, child]) => [kind, comparable(child)])),
          ]),
        ),
      };
    }
    for (const [i, e] of native.entries.entries()) {
      const entry = expected.toolbox[i];
      assert.deepEqual(
        comparable(e.definition),
        comparable(entry.definition),
        `${target.id}: ${e.definition.opcode}`,
      );
      assert.ok(Math.abs(e.y - (entry.position.y - scene.manifest.layout.toolbox.y)) < 0.01);
      function options(native, def) {
        for (const [name, choices] of Object.entries(native.options))
          assert.deepEqual(
            choices,
            entry.metadata[def.id].fields[name].options,
            `${target.id}: ${def.opcode}.${name} options`,
          );
        for (const [name, input] of Object.entries(native.inputs))
          for (const [kind, child] of Object.entries(input)) options(child, def.inputs[name][kind]);
      }
      options(e.definition, entry.definition);
      if (e.definition.mutation) {
        const parse = require('htmlparser2').parseDOM;
        const attrs = { ...parse(entry.definition.mutation)[0].attribs };
        delete attrs.xmlns;
        assert.deepEqual(attrs, e.definition.mutation, `${target.id}: ${entry.key} mutation`);
      }
    }
    assert.deepEqual(
      native.buttons,
      expected.decorations
        .filter((d) => d.kind !== 'separator' && d.kind !== 'checkbox')
        .map((d) => d.text),
    );
    const properties = await page
      .locator('[class*="sprite-info_sprite-info"] input')
      .evaluateAll((inputs) =>
        inputs.map((input) => ({
          value: input.value,
          placeholder: input.placeholder,
          disabled: input.disabled,
        })),
      );
    assert.equal(properties.length, 5);
    assert.deepEqual(
      properties.map((input) => input.value),
      target.isStage
        ? ['', '', '', '', '']
        : [
            target.name,
            String(Math.round(target.x)),
            String(Math.round(target.y)),
            String(Math.round(target.size)),
            String(Math.round(target.direction)),
          ],
    );
    assert.ok(properties.every((input) => input.disabled === target.isStage));
    if (target.isStage)
      assert.deepEqual(
        properties.slice(0, 3).map((input) => input.placeholder),
        ['名字', 'x', 'y'],
      );
    for (const category of ['motion', 'control', 'myBlocks']) {
      await page.evaluate(
        (category) =>
          ScratchBlocks.getMainWorkspace().getToolbox().setSelectedCategoryById(category),
        category,
      );
      await page.waitForFunction(() => !ScratchBlocks.getMainWorkspace().getFlyout().scrollTarget);
      await page.screenshot({ path: `${out}/reference-${target.id}-${category}.png` });
    }
    report.push({
      target: target.id,
      categories: native.categories,
      entries: native.entries.length,
      definitionsMatch: true,
      buttonsMatch: true,
    });
  }
  await writeFile(
    out + '/reference.json',
    JSON.stringify(
      {
        gui: scene.manifest.source.gui,
        disabledMenuAddons: ['rename-broadcasts', 'editor-searchable-dropdowns'],
        targets: report,
        randomColourDefaults:
          'Compared structurally; GUI uses random defaults, Motion uses a recorded preparation seed',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
