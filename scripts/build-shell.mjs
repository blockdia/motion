// Build-time extraction of the pinned editor's actual DOM and CSS. No GUI JS is shipped with these templates.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(resolve('.cache/gui/package.json'));
const postcss = require('postcss');
import { chromium } from 'playwright-core';
const root = resolve('.cache/gui/build'),
  out = resolve('artifacts/shell');
const build = JSON.parse(await readFile('.cache/gui/reference-build.json', 'utf8'));
if (build.commit !== 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff')
  throw Error('Unexpected pinned GUI build');
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      }[extname(file)] || 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  for (const locale of ['zh-CN', 'en'])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        locale,
        colorScheme: theme,
      });
      await page.addInitScript(
        (theme) =>
          localStorage.setItem(
            'tw:theme',
            JSON.stringify({ accent: 'red', gui: theme, blocks: 'three' }),
          ),
        theme,
      );
      await page.goto(
        `http://127.0.0.1:${server.address().port}/editor.html?locale=${locale === 'zh-CN' ? 'zh-cn' : 'en'}`,
      );
      await page
        .locator('.blocklyFlyout .blocklyBlockCanvas .blocklyDraggable')
        .first()
        .waitFor({ state: 'attached', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${out}/reference.${locale}.${theme}.png` });
      // Preserve authored declarations: CSSOM cssText loses variable-valued border
      // longhands when a later border-bottom shorthand overrides one side in Chrome.
      const sources = await page.evaluate(async () =>
        Promise.all(
          Array.from(document.styleSheets, async (sheet) =>
            sheet.href ? await (await fetch(sheet.href)).text() : sheet.ownerNode.textContent,
          ),
        ),
      );
      const sheets = sources.map((source) => postcss.parse(source));
      const conditions = [];
      for (const sheet of sheets)
        sheet.walkAtRules((rule) => {
          if (['media', 'supports'].includes(rule.name)) conditions.push([rule.name, rule.params]);
        });
      const matches = await page.evaluate(
        (conditions) =>
          conditions.map(([name, value]) =>
            name === 'media' ? matchMedia(value).matches : CSS.supports(value),
          ),
        conditions,
      );
      let condition = 0;
      for (const sheet of sheets) {
        sheet.walkComments((comment) => comment.remove());
        const rules = [];
        sheet.walkAtRules((rule) => {
          if (['media', 'supports'].includes(rule.name)) rules.push(rule);
        });
        for (const rule of rules) {
          if (matches[condition++]) rule.replaceWith(...rule.nodes);
          else rule.remove();
        }
        sheet.walkAtRules((rule) => rule.remove());
        sheet.walkRules((rule) => {
          rule.selectors = rule.selectors.map((selector) =>
            [':root', 'html', 'body'].includes(selector)
              ? '__MOTION_SCOPE__'
              : `__MOTION_SCOPE__ ${selector}`,
          );
        });
      }
      for (const sheet of sheets) {
        sheet.raws.after = '';
        sheet.walk((node) => {
          node.raws = { before: '', between: node.type === 'decl' ? ':' : '', after: '' };
        });
      }
      const scopedCSS = sheets.map((sheet) => sheet.toString()).join('\n');
      const snapshot = await page.evaluate(async (scopedCSS) => {
        const native = document.querySelector('[class*="gui_page-wrapper_"]');
        if (!native) throw Error('Missing native GUI root');
        const zoom = Array.from(native.querySelectorAll('.blocklyZoom image')).map((e) => {
          const r = e.getBoundingClientRect(),
            src = e.getAttribute('href') || e.getAttribute('xlink:href');
          return {
            src,
            action: src.includes('zoom-in') ? 'in' : src.includes('zoom-out') ? 'out' : 'reset',
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          };
        });
        const root = native.cloneNode(true);
        const reference = Object.fromEntries(
          Object.entries({
            menu: '[class*="menu-bar_menu-bar_"]',
            tabs: '[class*="gui_tab-list_"]',
            properties: '[class*="sprite-info_sprite-info_"]',
            stage: '[class*="stage_stage_"]',
            sprites: '[class*="sprite-selector_sprite-selector_"]',
            backdrop: '[class*="stage-selector_stage-selector_"]',
          }).map(([name, selector]) => {
            const e = native.querySelector(selector),
              r = e.getBoundingClientRect(),
              style = getComputedStyle(e);
            return [
              name,
              {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                background: style.backgroundColor,
                borderColor: style.borderTopColor,
              },
            ];
          }),
        );
        const find = (s) => {
          const e = root.querySelector(s);
          if (!e) throw Error('Missing native slot: ' + s);
          return e;
        };
        const mark = (name, selector) => {
          const e = find(selector);
          e.dataset.native = name;
          return e;
        };
        const vars = {};
        const computed = getComputedStyle(native);
        for (const p of computed) if (p.startsWith('--')) vars[p] = computed.getPropertyValue(p);
        // Keep the editor's flex layouts; remove rendered project pixels and Blockly state only.
        root
          .querySelectorAll(
            'script,canvas,.blocklySvg,.blocklyFlyout,.blocklyWidgetDiv,.blocklyDropDownDiv,.blocklyScrollbarVertical,.blocklyScrollbarHorizontal',
          )
          .forEach((e) => e.remove());
        root
          .querySelectorAll('[class*="stage_stage-overlays_"]')
          .forEach((e) => e.replaceChildren());
        const stage = mark('stage', '[class*="stage_stage_"]');
        stage.replaceChildren();
        const categories = mark('categories', '.scratchCategoryMenu');
        const category = categories.querySelector('.scratchCategoryMenuItem').outerHTML;
        categories.replaceChildren();
        const properties = mark('properties', '[class*="sprite-info_sprite-info_"]');
        const inputs = Array.from(properties.querySelectorAll('input'));
        if (inputs.length !== 5)
          throw Error('Unexpected sprite properties structure: ' + inputs.length);
        inputs.forEach(
          (input, i) => (input.dataset.property = ['name', 'x', 'y', 'size', 'direction'][i]),
        );
        const targets = mark('targets', '[class*="sprite-selector_items-wrapper_"]');
        const tile =
          targets
            .querySelector('[class*="sprite-selector-item_sprite-selector-item_"]')
            ?.closest('[class*="sprite-selector-item_sprite-wrapper_"]') ??
          targets.firstElementChild;
        if (!tile) throw Error('Missing native sprite tile');
        const tileHTML = tile.outerHTML;
        targets.replaceChildren();
        mark('backdrop', '[class*="stage-selector_stage-selector_"]');
        mark('menu', '[class*="menu-bar_menu-bar_"]');
        mark('tabs', '[class*="gui_tab-list_"]');
        mark('sprites', '[class*="sprite-selector_sprite-selector_"]');
        mark('blocks', '[class*="blocks_blocks_"]');
        root.querySelectorAll('[class*="watermark_sprite-image_"]').forEach((e) => e.remove());
        for (const input of root.querySelectorAll('input')) {
          const source =
            native.querySelectorAll('input')[
              Array.from(root.querySelectorAll('input')).indexOf(input)
            ];
          input.setAttribute('value', source?.value ?? input.value);
          input.readOnly = true;
        }
        for (const e of root.querySelectorAll('*')) {
          for (const a of Array.from(e.attributes))
            if (
              a.name.startsWith('on') ||
              ['id', 'aria-controls', 'aria-labelledby', 'href'].includes(a.name)
            )
              e.removeAttribute(a.name);
          e.setAttribute('tabindex', '-1');
        }
        let css = scopedCSS;
        // A fixed logical canvas must not inherit the embedding page's rem unit or viewport breakpoints.
        css = css.replace(/(-?[\d.]+)rem\b/g, (_, n) => `${Number(n) * 16}px`);
        const cache = new Map();
        async function embed(url) {
          if (url.startsWith('data:') || url.startsWith('#')) return url;
          const absolute = new URL(url, location.href).href;
          if (!cache.has(absolute))
            cache.set(
              absolute,
              (async () => {
                const r = await fetch(absolute);
                if (!r.ok) throw Error('Missing native asset ' + absolute);
                const bytes = new Uint8Array(await r.arrayBuffer());
                return `data:${r.headers.get('content-type') || 'application/octet-stream'};base64,${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`;
              })(),
            );
          return cache.get(absolute);
        }
        for (const control of zoom) control.src = await embed(control.src);
        for (const img of root.querySelectorAll('img')) {
          if (img.getAttribute('src')) img.src = await embed(img.getAttribute('src'));
        }
        for (const match of [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) {
          const value = await embed(match[1]);
          css = css.replaceAll(match[0], `url("${value}")`);
        }
        async function template(html) {
          const div = document.createElement('div');
          div.innerHTML = html;
          for (const img of div.querySelectorAll('img')) {
            if (img.getAttribute('src')) img.src = await embed(img.getAttribute('src'));
          }
          div.querySelectorAll('nav,script').forEach((e) => e.remove());
          for (const e of div.querySelectorAll('*')) {
            for (const a of Array.from(e.attributes))
              if (a.name.startsWith('on') || ['id', 'href'].includes(a.name))
                e.removeAttribute(a.name);
            e.setAttribute('tabindex', '-1');
          }
          return div.innerHTML;
        }
        return {
          zoom,
          reference,
          html: root.outerHTML,
          css,
          variables: vars,
          category: await template(category),
          tile: await template(tileHTML),
        };
      }, scopedCSS);
      const json = JSON.stringify({ ...snapshot, source: { gui: build.commit, locale, theme } });
      await writeFile(`${out}/shell.${locale}.${theme}.json`, json);
      console.log(locale, theme, json.length, createHash('sha256').update(json).digest('hex'));
      await page.close();
    }
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
await writeFile(
  resolve(out, 'build.json'),
  JSON.stringify({
    gui: build.commit,
    extractionSha256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
  }),
);
