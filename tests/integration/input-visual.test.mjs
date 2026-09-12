import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createAdapter } from '../../packages/asset-builder/dist/index.js';
import { compile } from '../../packages/authoring/dist/index.js';
import { evaluate } from '../../packages/core/dist/index.js';
import { frameSvg } from '../../packages/renderer-browser/dist/index.js';
import { serve, root } from '../../scripts/server.mjs';
import tutorial from '../../examples/basic-editing/tutorial.ts';
const out = root + '/artifacts/input-regression';
const definition = {
  id: 'hat',
  opcode: 'event_whenflagclicked',
  next: {
    id: 'move',
    opcode: 'motion_movesteps',
    inputs: { STEPS: { shadow: { id: 'value', opcode: 'math_number', fields: { NUM: '10' } } } },
  },
};

test('native Blockly input geometry and rendered editing states match, with complete toolbox hat', async () => {
  await mkdir(out, { recursive: true });
  const adapter = await createAdapter({ project: tutorial.project });
  let compiled;
  try {
    const entry = adapter.manifest.targets.sprite.toolbox.find((e) =>
      e.aliases.includes('events.whenFlagClicked'),
    );
    assert.ok(
      entry.position.y +
        adapter.manifest.resources[entry.asset].box.y * adapter.manifest.layout.blockScale >=
        adapter.manifest.layout.toolbox.y + 43,
    );
    compiled = await compile(
      {
        ...tutorial,
        steps: [
          {
            op: 'paste',
            blocks: [definition],
            to: { kind: 'workspaceSlot', name: 'main' },
            duration: 0.1,
          },
          {
            op: 'type',
            target: { kind: 'field', id: 'move', name: 'steps' },
            value: '1234567890',
            duration: 1,
          },
        ],
      },
      adapter,
    );
    const track = compiled.tracks.find((t) => t.kind === 'input');
    const first = compiled.manifest.resources[track.frames[1].asset],
      last = compiled.manifest.resources[track.frames.at(-1).asset];
    assert.equal(first.input.text, '');
    assert.equal(last.input.text, '1234567890');
    assert.ok(last.box.width > first.box.width);
    assert.ok(last.input.bounds.width > first.input.bounds.width);
    assert.equal(last.input.radius, 16.5);
    assert.equal(last.input.shadowWidth, 4);
    assert.equal(last.input.stroke, 'rgb(51, 115, 204)');
    assert.deepEqual(last.anchors.hat.connections.next, last.anchors.move.connections.previous);
  } finally {
    await adapter.dispose();
  }
  // Independent native workspace reference, using XML and the actual HTML editor.
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const native = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    await native.goto(server.url + '/packages/asset-builder/prepare.html');
    await native.evaluate(async (project) => {
      await window.startPreparation(project);
      document.body.style.margin = '0';
      const style = document.createElement('style');
      style.textContent =
        '.blocklyMainBackground{fill:#f9f9f9!important;stroke:none!important}.blocklyHtmlInput{caret-color:transparent!important}';
      document.head.append(style);
      const B = Blockly,
        ws = Object.values(B.Workspace.WorkspaceDB_).find((w) => !w.isFlyout);
      ws.setScale(0.675);
      ws.setResizesEnabled(false);
      B.Xml.domToWorkspace(
        B.Xml.textToDom(
          '<xml><block id="hat" type="event_whenflagclicked"><next><block id="move" type="motion_movesteps"><value name="STEPS"><shadow id="value" type="math_number"><field name="NUM">10</field></shadow></value></block></next></block></xml>',
        ),
        ws,
      );
      const root = ws.getBlockById('hat'),
        f = ws.getBlockById('value').getField('NUM');
      const rect = root.getSvgRoot().getBoundingClientRect(),
        box = root.getSvgRoot().getBBox();
      root.moveBy((430 + box.x * 0.675 - rect.x) / 0.675, (190 + box.y * 0.675 - rect.y) / 0.675);
      B.FieldTextInput.prototype.showEditor_.call(f, true);
      B.WidgetDiv.DIV.style.transition = 'none';
      B.FieldTextInput.htmlInput_.style.transition = 'none';
      window.nativeInput = { B, ws, root, f };
    }, tutorial.project);
    const motion = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    await motion.goto(server.url + '/packages/asset-builder/prepare.html');
    await motion.evaluate(async () => {
      document.body.replaceChildren();
      document.body.style.margin = '0';
      const font = await new FontFace('Motion Sans', 'url(/font.ttf)').load();
      document.fonts.add(font);
    });
    const visual = structuredClone(compiled);
    visual.manifest.chrome = '<rect width="1280" height="720" fill="#f9f9f9"/>';
    const track = visual.tracks.find((t) => t.kind === 'input'),
      report = [];
    const clip = { x: 415, y: 165, width: 230, height: 115 };
    for (const text of ['1', '1234567890']) {
      await native.evaluate((text) => {
        const { B, f } = window.nativeInput;
        B.FieldTextInput.htmlInput_.value = text;
        f.onHtmlInputChange_({ type: 'input' });
        f.resizeEditor_();
      }, text);
      const frame = track.frames.find(
        (f) => visual.manifest.resources[f.asset].input.text === text,
      );
      const time = track.start + frame.offset + 0.001;
      // Move the tutorial cursor out of the reference crop; input avoidance is checked separately.
      const svg = frameSvg(time, visual).replace(
        /<path transform="translate\([^"]+\)" d="M0 0 L0 23[^>]+\/>/,
        '',
      );
      await motion.evaluate((svg) => {
        document.body.innerHTML = svg;
      }, svg);
      await native.screenshot({ path: `${out}/native-${text}.png`, clip });
      await motion.screenshot({ path: `${out}/motion-${text}.png`, clip });
      const difference = await motion.evaluate(async (text) => {
        const pixels = async (name) => {
          const image = new Image();
          image.src = `/artifacts/input-regression/${name}-${text}.png`;
          await image.decode();
          const c = document.createElement('canvas');
          c.width = image.width;
          c.height = image.height;
          const x = c.getContext('2d');
          x.drawImage(image, 0, 0);
          return x.getImageData(0, 0, c.width, c.height).data;
        };
        const a = await pixels('native'),
          b = await pixels('motion');
        let sum = 0,
          changed = 0;
        for (let i = 0; i < a.length; i += 4) {
          let max = 0;
          for (let j = 0; j < 3; j++) {
            const d = Math.abs(a[i + j] - b[i + j]);
            sum += d;
            max = Math.max(max, d);
          }
          if (max > 32) changed++;
        }
        return {
          meanChannelError: sum / ((a.length / 4) * 3),
          changedPixelRatio: changed / (a.length / 4),
        };
      }, text);
      report.push({ text, ...difference });
      assert.ok(
        difference.meanChannelError < 3 && difference.changedPixelRatio < 0.03,
        JSON.stringify({ text, ...difference }),
      );
      const snapshot = evaluate(time, compiled);
      assert.equal(snapshot.input.appearance.text, text);
    }
    await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
    await native.evaluate(() => window.disposePreparation());
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
});
