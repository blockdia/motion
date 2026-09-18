import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

// Serve only the release directory, with ordinary directory indexes and no app routes.
async function staticServer(prefix) {
  const root = resolve('dist/playground');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(prefix)) throw Error('Outside published site');
      let file = resolve(root, '.' + '/' + pathname.slice(prefix.length));
      if (file !== root && !file.startsWith(root + sep)) throw Error('Outside release directory');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const bytes = await readFile(file);
      response.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.mp4': 'video/mp4',
          }[extname(file)] || 'application/octet-stream',
        'Content-Length': bytes.length,
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${prefix}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

for (const prefix of ['/', '/motion/']) {
  test(`published playground works at ${prefix}`, { timeout: 180000 }, async () => {
    const server = await staticServer(prefix);
    let browser;
    try {
      browser = await chromium.launch({
        executablePath:
          process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
      });
      const page = await browser.newPage();
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('response', (response) => {
        if (!response.ok()) failures.push(`${response.status()} ${response.url()}`);
      });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(server.url).origin || !url.pathname.startsWith(prefix)) {
          failures.push(`Request outside static site: ${url.href}`);
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(server.url);
      await page.waitForFunction(() => window.ready);
      assert.equal(await page.locator('#error').textContent(), '');
      let frame = page.frames().find((frame) => frame.parentFrame());
      await frame.evaluate(() => window.player.seek(0.5));
      const video = frame.locator('video:not([hidden])');
      await video.evaluate((video) => {
        if (video.readyState >= 2) return;
        return new Promise((resolve) =>
          video.addEventListener('loadeddata', resolve, { once: true }),
        );
      });
      assert.ok((await video.evaluate((video) => video.currentSrc)).startsWith(server.url));
      await page.locator('#locale').selectOption('en');
      await page.waitForFunction(
        () => window.ready && document.querySelector('#locale').value === 'en',
      );
      frame = page.frames().find((frame) => frame.parentFrame());
      assert.equal(await frame.evaluate(() => window.player.appearance.locale), 'en');
      await page.reload();
      await page.waitForFunction(() => window.ready);
      assert.equal(await page.locator('#locale').inputValue(), 'en');
      const englishScene = new URL('artifacts/playground/tutorial.en.json', server.url).href;
      await page.goto(server.url + '?scene=' + encodeURIComponent(englishScene));
      await page.waitForFunction(() => window.ready);
      assert.equal(await page.locator('#locale').inputValue(), 'en');
      assert.equal(await page.locator('#locale').isDisabled(), false);
      for (const name of ['all-api', 'structural-editing', 'basic-editing', 'targets']) {
        await page.locator('#tutorial').selectOption(`./artifacts/${name}/tutorial.json`);
        await page.waitForFunction(() => window.ready);
        assert.equal(await page.locator('#error').textContent(), '');
        assert.equal(await page.locator('iframe#player').count(), 1);
      }
      const playerUrl = await page.locator('#open-player').getAttribute('href');
      assert.equal(new URL(playerUrl).pathname, prefix + 'player/');
      assert.ok(new URL(playerUrl).searchParams.get('scene').startsWith(server.url));
      await page.goto(playerUrl);
      await page.waitForFunction(() => window.ready);
      await page.reload();
      await page.waitForFunction(() => window.ready);
      assert.equal(await page.locator('[data-motion-preparation]').count(), 0);
      assert.deepEqual(failures, []);
    } finally {
      await browser?.close();
      await server.close();
    }
  });
}
