// Independent reference: load the real pinned GUI, not Motion's prepared shell.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve('.cache/gui/build');
const build = JSON.parse(await readFile('.cache/gui/reference-build.json', 'utf8'));
if (build.commit !== 'a2946eeb9a9dca7857d7ab53d766b54288c7a2ff')
  throw Error('Unexpected GUI reference');
await mkdir('artifacts/p3', { recursive: true });
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
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      locale: 'zh-CN',
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
    await page.goto(`http://127.0.0.1:${server.address().port}/editor.html?locale=zh-cn`);
    await page
      .locator('.blocklyFlyout .blocklyBlockCanvas .blocklyDraggable')
      .first()
      .waitFor({ state: 'attached', timeout: 60000 });
    await page.waitForFunction((theme) => {
      const menu = document.querySelector('[class*="menu-bar_menu-bar_"]');
      return (
        menu &&
        getComputedStyle(menu).backgroundColor ===
          (theme === 'dark' ? 'rgb(51, 51, 51)' : 'rgb(255, 76, 76)')
      );
    }, theme);
    await page.evaluate(() => document.fonts.ready);
    const styles = await page.evaluate(() => {
      const capture = (selector, property) => {
        const node = document.querySelector(selector);
        if (!node) throw Error('Missing reference element: ' + selector);
        return getComputedStyle(node)[property];
      };
      return {
        menu: capture('[class*="menu-bar_menu-bar_"]', 'backgroundColor'),
        feedbackBackground: capture('[class*="menu-bar_feedback-button_"]', 'backgroundColor'),
        feedbackText: capture('[class*="menu-bar_feedback-link_"]', 'color'),
        workspace: capture('.blocklySvg', 'backgroundColor'),
        flyout: capture('.blocklyFlyoutBackground', 'fill'),
        flyoutOpacity: capture('.blocklyFlyoutBackground', 'fillOpacity'),
        category: capture('.scratchCategoryMenu', 'backgroundColor'),
        input: capture('[class*="sprite-info_sprite-info_"] input', 'backgroundColor'),
      };
    });
    await writeFile(`artifacts/p3/reference-${theme}.json`, JSON.stringify(styles, null, 2));
    await page.screenshot({ path: `artifacts/p3/reference-${theme}.png` });
    console.log(theme, styles);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
