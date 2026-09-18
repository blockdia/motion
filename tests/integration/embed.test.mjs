import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { openBrowser } from '../../packages/asset-builder/dist/index.js';
import { bundleTutorial } from '../../packages/authoring/dist/bundle.js';
import tutorial from '../../examples/basic-editing/tutorial.ts';

const prefix = '/artifacts/browser-tests/embed/';

async function fixture(duration = 2) {
  await mkdir('.' + prefix, { recursive: true });
  await cp('artifacts/media/stage.mp4', '.' + prefix + 'stage.mp4');
  const bundle = await bundleTutorial({
    ...tutorial,
    steps: [{ op: 'wait', duration }],
    stage: { clips: [{ src: 'stage.mp4', start: 0, in: 0, duration: 2 }] },
  });
  await writeFile('.' + prefix + 'tutorial.json', JSON.stringify(bundle));
}

async function assertFits(page) {
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector('.motion-frame').getBoundingClientRect();
    const host = document.querySelector('#player').getBoundingClientRect();
    const footer = document.querySelector('#controls').getBoundingClientRect();
    return {
      x: host.x,
      y: host.y,
      right: host.right,
      bottom: host.bottom,
      ratio: frame.width / frame.height,
      hostWidth: host.width,
      footerBottom: footer.bottom,
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  assert.ok(geometry.x >= -1 && geometry.y >= -1, JSON.stringify(geometry));
  assert.ok(geometry.right <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.bottom <= geometry.height + 1, JSON.stringify(geometry));
  assert.ok(geometry.footerBottom <= geometry.height + 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.ratio - 1280 / 720) < 0.01);
  assert.ok(
    Math.abs(geometry.hostWidth - Math.min(geometry.width, geometry.height * (1280 / 720))) < 1,
    JSON.stringify(geometry),
  );
  assert.equal(geometry.scrollWidth, geometry.width);
  assert.equal(geometry.scrollHeight, geometry.height);
}

test('standalone player loads redirect-relative media, theme, controls and resizes in both axes', async () => {
  await fixture();
  const h = await openBrowser();
  const errors = [];
  h.page.on('pageerror', (error) => errors.push(error.message));
  try {
    await h.page.route('**/redirect-tutorial.json', (route) =>
      route.fulfill({ status: 302, headers: { location: prefix + 'tutorial.json' } }),
    );
    await h.page.goto(h.server.url + '/player/?scene=/redirect-tutorial.json&theme=dark');
    await h.page.waitForFunction(() => window.ready === true);
    assert.equal(await h.page.locator('.toolbar').count(), 0);
    assert.equal(await h.page.locator('[data-motion-preparation]').count(), 0);
    assert.equal(await h.page.evaluate(() => window.player.appearance.theme), 'dark');
    assert.equal(await h.page.locator('video:not([hidden])').count(), 1);
    assert.equal(
      await h.page.locator('video:not([hidden])').evaluate((video) => video.currentSrc),
      h.server.url + prefix + 'stage.mp4',
    );
    for (const [width, height] of [
      [1000, 240],
      [320, 480],
      [640, 360],
      [240, 180],
    ]) {
      await h.page.setViewportSize({ width, height });
      await h.page.waitForFunction(() => {
        const host = document.querySelector('#player').getBoundingClientRect();
        const width = Math.min(innerWidth, innerHeight * (1280 / 720));
        return Math.abs(host.width - width) < 1 && host.bottom <= innerHeight + 1;
      });
      await assertFits(h.page);
    }
    await h.page.locator('#play').click();
    await h.page.waitForFunction(() => window.player.time > 0.1);
    await h.page.locator('#play').click();
    assert.equal(await h.page.evaluate(() => window.player.playing), false);
    await h.page.locator('#progress').evaluate((input) => {
      input.value = '1.25';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await h.page.waitForFunction(() => window.player.time === 1.25);
    const cleanup = await h.page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
      return {
        ready: window.ready,
        children: document.querySelector('#player').children.length,
        preparationFrames: document.querySelectorAll('[data-motion-preparation]').length,
      };
    });
    assert.deepEqual(cleanup, { ready: false, children: 0, preparationFrames: 0 });
    assert.deepEqual(errors, []);
  } finally {
    await h.close();
  }
});

test('relocated embed entry plays in an iframe without requests outside deployed resources', async () => {
  await fixture();
  const h = await openBrowser();
  try {
    await cp('artifacts/runtime/turbowarp-7c58de66-a2946eeb-client-1', '.' + prefix + 'runtime', {
      recursive: true,
    });
    const unexpected = [];
    await h.page.route('**/*', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith(prefix)) {
        unexpected.push(pathname);
        return route.abort();
      }
      return route.continue();
    });
    await writeFile(
      '.' + prefix + 'host.html',
      '<!doctype html><style>body{margin:0}iframe{width:640px;height:360px;border:0}</style><iframe title="Tutorial" src="runtime/embed.html?scene=../tutorial.json&controls=0&autoplay=1"></iframe>',
    );
    await h.page.goto(h.server.url + prefix + 'host.html');
    const frame = h.page.frames().find((frame) => frame.parentFrame());
    await frame.waitForFunction(() => window.ready === true && window.player.time > 0);
    assert.equal(await frame.locator('#controls').isVisible(), false);
    await frame.waitForFunction(() => window.player.playing === false && window.player.time === 2);
    const geometry = await frame.locator('.motion-frame').boundingBox();
    assert.equal(geometry.width, 640);
    assert.equal(geometry.height, 360);
    assert.deepEqual(unexpected, []);
    assert.equal(await frame.locator('[data-motion-preparation]').count(), 0);
    await h.page.screenshot({ path: 'artifacts/browser-tests/embed-iframe.png' });
  } finally {
    await h.close();
  }
});

test('video controls support popup settings, synchronized speed, auto-hide, keyboard and fullscreen', async () => {
  await fixture(8);
  const h = await openBrowser();
  try {
    await h.page.setViewportSize({ width: 640, height: 360 });
    await h.page.goto(h.server.url + '/player/?scene=' + prefix + 'tutorial.json');
    await h.page.waitForFunction(() => window.ready);
    await h.page.locator('#settings-toggle').click();
    assert.equal(await h.page.locator('#settings').isVisible(), true);
    assert.equal(await h.page.locator('#settings-toggle').getAttribute('aria-expanded'), 'true');
    await h.page.locator('#speed').selectOption('2');
    assert.equal(await h.page.evaluate(() => window.player.playbackRate), 2);
    assert.equal(await h.page.locator('video:not([hidden])').evaluate((v) => v.playbackRate), 2);
    const invalidRates = await h.page.evaluate(() => {
      let rejected = 0;
      for (const value of [0, NaN, 5]) {
        try {
          window.player.setPlaybackRate(value);
        } catch {
          rejected++;
        }
      }
      return { rejected, rate: window.player.playbackRate };
    });
    assert.deepEqual(invalidRates, { rejected: 3, rate: 2 });
    await h.page.locator('#motion').selectOption('curve');
    await h.page.locator('#effect').selectOption('shrink');
    assert.deepEqual(
      await h.page.evaluate(() => [window.player.cursorMotion, window.player.cursorClickEffect]),
      ['curve', 'shrink'],
    );
    await h.page.evaluate(() => window.player.seek(0.5));
    await h.page.locator('#theme').selectOption('dark');
    await h.page.waitForFunction(
      () =>
        window.player.appearance.theme === 'dark' &&
        document.querySelector('#player').getAttribute('aria-busy') === 'false',
    );
    assert.equal(await h.page.evaluate(() => window.player.time), 0.5);
    assert.equal(await h.page.evaluate(() => window.player.playbackRate), 2);
    await h.page.screenshot({ path: 'artifacts/browser-tests/embed-settings.png' });
    await h.page.keyboard.press('Escape');
    assert.equal(await h.page.locator('#settings').isVisible(), false);
    assert.equal(
      await h.page.locator('#settings-toggle').evaluate((b) => b === document.activeElement),
      true,
    );
    await h.page.locator('#play').click();
    const start = await h.page.evaluate(() => ({
      time: window.player.time,
      now: performance.now(),
    }));
    await h.page.waitForFunction(() => window.player.time > 1.3);
    const elapsed = await h.page.evaluate(
      (start) => ({
        tutorial: window.player.time - start.time,
        wall: (performance.now() - start.now) / 1000,
      }),
      start,
    );
    assert.ok(elapsed.tutorial > elapsed.wall * 1.5, JSON.stringify(elapsed));
    assert.equal(await h.page.locator('video:not([hidden])').evaluate((v) => v.playbackRate), 2);
    await h.page.locator('.motion-frame').focus();
    await h.page.keyboard.press('k');
    assert.equal(await h.page.evaluate(() => window.player.playing), false);
    await h.page.keyboard.press('Space');
    assert.equal(await h.page.evaluate(() => window.player.playing), true);
    await h.page.mouse.move(300, 100);
    await h.page.waitForFunction(() => document.querySelector('#player').dataset.visible === '0');
    await h.page.mouse.move(300, 330);
    await h.page.waitForFunction(() => document.querySelector('#player').dataset.visible === '1');
    await h.page.locator('#play').click();
    await h.page.locator('#settings-toggle').click();
    await h.page.mouse.click(300, 100);
    assert.equal(await h.page.locator('#settings').isVisible(), false);
    if (await h.page.evaluate(() => document.fullscreenEnabled)) {
      await h.page.locator('#fullscreen').click();
      await h.page.waitForFunction(() => document.fullscreenElement?.id === 'viewport');
      await h.page.locator('#fullscreen').click();
      await h.page.waitForFunction(() => !document.fullscreenElement);
    }
    await h.page.setViewportSize({ width: 240, height: 180 });
    await h.page.locator('#settings-toggle').click();
    await h.page.waitForFunction(
      () => document.querySelector('#player').getBoundingClientRect().width <= 240,
    );
    const bounds = await h.page.locator('#settings').boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 241 &&
        bounds.y + bounds.height <= 181,
    );
    await h.page.screenshot({ path: 'artifacts/browser-tests/embed-settings-narrow.png' });
  } finally {
    await h.close();
  }
});

test('standalone entry shows actionable URL, network and bundle errors and cleans failed preparation', async () => {
  const h = await openBrowser();
  try {
    await h.page.route(
      (url) => url.pathname === '/invalid-tutorial.json',
      (route) => route.fulfill({ contentType: 'application/json', body: '{}' }),
    );
    for (const [query, message] of [
      ['', /scene/],
      ['?scene=data:application/json,%7B%7D', /HTTP/],
      ['?scene=/missing.json&theme=unknown', /theme/],
      ['?scene=/missing.json&controls=false', /controls/],
      ['?scene=/missing.json&autoplay=yes', /autoplay/],
      ['?scene=/missing.json', /404/],
      ['?scene=/invalid-tutorial.json', /./],
    ]) {
      await h.page.goto(h.server.url + '/player/' + query);
      await h.page.waitForFunction(() => document.querySelector('#message').role === 'alert');
      assert.match(await h.page.locator('#message').textContent(), message);
      assert.equal(await h.page.evaluate(() => window.ready), false);
      assert.equal(await h.page.locator('#player').getAttribute('aria-busy'), 'false');
      assert.equal(await h.page.locator('[data-motion-preparation]').count(), 0);
    }
    await fixture();
    await h.page.route('**/shell.zh-CN.light.json', (route) => route.abort());
    await h.page.goto(h.server.url + '/player/?theme=light&scene=' + prefix + 'tutorial.json');
    await h.page.waitForFunction(() => document.querySelector('#message').role === 'alert');
    assert.equal(await h.page.locator('.motion-frame').count(), 0);
    assert.equal(await h.page.locator('[data-motion-preparation]').count(), 0);
  } finally {
    await h.close();
  }
});

test('player defaults to live system theme, preserves time and supports manual overrides', async () => {
  await fixture();
  const h = await openBrowser();
  try {
    await h.page.emulateMedia({ colorScheme: 'dark' });
    await h.page.goto(h.server.url + '/player/?scene=' + prefix + 'tutorial.json');
    await h.page.waitForFunction(() => window.ready);
    assert.equal(await h.page.evaluate(() => window.player.appearance.theme), 'dark');
    assert.equal(await h.page.locator('#theme').inputValue(), 'system');
    await h.page.evaluate(() => window.player.seek(0.7));
    await h.page.emulateMedia({ colorScheme: 'light' });
    await h.page.waitForFunction(
      () =>
        window.player.appearance.theme === 'light' &&
        document.querySelector('#player').getAttribute('aria-busy') === 'false',
    );
    assert.equal(await h.page.evaluate(() => window.player.time), 0.7);
    await h.page.locator('#settings-toggle').click();
    await h.page.locator('#theme').selectOption('dark');
    await h.page.waitForFunction(
      () =>
        window.player.appearance.theme === 'dark' &&
        document.querySelector('#player').getAttribute('aria-busy') === 'false',
    );
    await h.page.emulateMedia({ colorScheme: 'dark' });
    await h.page.emulateMedia({ colorScheme: 'light' });
    await h.page.waitForFunction(() => !matchMedia('(prefers-color-scheme: dark)').matches);
    assert.equal(await h.page.evaluate(() => window.player.appearance.theme), 'dark');
    assert.equal(await h.page.locator('#theme').inputValue(), 'dark');
    assert.equal(new URL(h.page.url()).searchParams.get('theme'), 'dark');
    await h.page.locator('#theme').selectOption('system');
    await h.page.waitForFunction(
      () =>
        window.player.appearance.theme === 'light' &&
        document.querySelector('#player').getAttribute('aria-busy') === 'false',
    );
    assert.equal(new URL(h.page.url()).searchParams.get('theme'), null);
    await h.page.emulateMedia({ colorScheme: 'dark' });
    await h.page.waitForFunction(
      () =>
        window.player.appearance.theme === 'dark' &&
        document.querySelector('#player').getAttribute('aria-busy') === 'false',
    );
    assert.equal(await h.page.evaluate(() => window.player.time), 0.7);
    await h.page.goto(h.server.url + '/player/?theme=light&scene=' + prefix + 'tutorial.json');
    await h.page.waitForFunction(() => window.ready);
    assert.equal(await h.page.evaluate(() => window.player.appearance.theme), 'light');
    assert.equal(await h.page.locator('#theme').inputValue(), 'light');
  } finally {
    await h.close();
  }
});

test('playground embeds the player, switches language and tutorials and keeps one active frame', async () => {
  await fixture();
  const en = await bundleTutorial({
    ...tutorial,
    defaults: { locale: 'en', theme: 'light' },
    steps: [{ op: 'wait', duration: 2 }],
  });
  const h = await openBrowser();
  try {
    await h.page.route(
      (url) => url.pathname === '/artifacts/playground/tutorial.zh-CN.json',
      (route) => route.fulfill({ path: '.' + prefix + 'tutorial.json' }),
    );
    await h.page.route(
      (url) => url.pathname === '/artifacts/playground/tutorial.en.json',
      (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(en) }),
    );
    await h.page.route(
      (url) => url.pathname === '/artifacts/playground/stage.mp4',
      (route) => route.fulfill({ path: '.' + prefix + 'stage.mp4' }),
    );
    await h.page.emulateMedia({ colorScheme: 'dark' });
    await h.page.goto(h.server.url + '/');
    await h.page.waitForFunction(() => window.ready);
    assert.equal(await h.page.locator('iframe#player').count(), 1);
    assert.equal(await h.page.locator('.motion-scene').count(), 0);
    assert.equal(await h.page.locator('#theme').count(), 0);
    let frame = h.page.frames().find((frame) => frame.parentFrame());
    assert.equal(await frame.evaluate(() => window.player.appearance.theme), 'dark');
    await frame.evaluate(() => window.player.seek(0.6));
    await frame.locator('#settings-toggle').click();
    await frame.locator('#theme').selectOption('light');
    await frame.waitForFunction(
      () =>
        window.player.appearance.theme === 'light' &&
        document.querySelector('#player').getAttribute('aria-busy') === 'false',
    );
    await frame.locator('#speed').selectOption('1.5');
    await h.page.locator('#locale').selectOption('en');
    await h.page.waitForFunction(
      () => window.ready && document.querySelector('#locale').value === 'en',
    );
    frame = h.page.frames().find((frame) => frame.parentFrame());
    assert.deepEqual(
      await frame.evaluate(() => ({
        locale: window.player.appearance.locale,
        theme: window.player.appearance.theme,
        rate: window.player.playbackRate,
        time: window.player.time,
      })),
      { locale: 'en', theme: 'light', rate: 1.5, time: 0.6 },
    );
    assert.equal(await frame.locator('#speed').inputValue(), '1.5');
    assert.equal(await frame.locator('#theme').inputValue(), 'light');
    assert.equal(
      new URL(await h.page.locator('#open-player').getAttribute('href')).searchParams.get('theme'),
      'light',
    );
    await h.page.locator('#reload').click();
    await h.page.waitForFunction(() => window.ready);
    frame = h.page.frames().find((frame) => frame.parentFrame());
    assert.equal(await frame.evaluate(() => window.player.time), 0);
    assert.equal(await h.page.locator('iframe#player').count(), 1);
    await h.page.locator('#tutorial').selectOption('./artifacts/basic-editing/tutorial.json');
    await h.page.waitForFunction(() => window.ready);
    assert.equal(await h.page.locator('#locale').isDisabled(), true);
    assert.equal(await h.page.locator('iframe#player').count(), 1);
    await h.page.screenshot({
      path: 'artifacts/browser-tests/playground-iframe.png',
      fullPage: true,
    });
  } finally {
    await h.close();
  }
});
