// Capture the actual fixed GUI build; this is preparation-only, never a player dependency.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
const root = resolve(".cache/gui/build");
const out = resolve("docs/p1a-baseline");
const build = JSON.parse(
  await readFile(resolve(".cache/gui/reference-build.json"), "utf8"),
);
if (build.commit !== "a2946eeb9a9dca7857d7ab53d766b54288c7a2ff")
  throw Error("Unexpected reference build");
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      "." + new URL(req.url, "http://localhost").pathname,
    );
    if (!path.startsWith(root + sep)) throw Error("path");
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
        ".css": "text/css",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
  });
  page.on("pageerror", (e) => console.error(e.message));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/editor.html?locale=zh-cn`,
  );
  await page
    .locator(".blocklyFlyout .blocklyBlockCanvas .blocklyDraggable")
    .first()
    .waitFor({ timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out + "/reference.png" });
  const details = await page.evaluate(() => ({
    images: [...document.querySelectorAll("img")]
      .map((el) => {
        const b = el.getBoundingClientRect();
        return {
          src: el.src,
          alt: el.alt,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        };
      })
      .filter((el) => el.width > 0 && el.height > 0),
    categories: [...document.querySelectorAll(".scratchCategoryMenuItem")].map(
      (el) => ({
        text: el.textContent,
        rect: el.getBoundingClientRect().toJSON(),
      }),
    ),
    blocks: [
      ...document.querySelectorAll(".blocklyFlyout .blocklyBlockCanvas"),
    ].map((el) => ({ transform: el.getAttribute("transform") })),
  }));
  await writeFile(
    resolve(".cache/reference-details.json"),
    JSON.stringify(details, null, 2),
  );
  const iconDir = resolve(".cache/gui-icons");
  await mkdir(iconDir, { recursive: true });
  for (const [i, icon] of details.images.entries()) {
    if (icon.src.startsWith("data:") || !icon.src.endsWith(".svg")) continue;
    const data = await readFile(
      resolve(root, "." + new URL(icon.src).pathname),
    );
    const name = new URL(icon.src).pathname.split("/").pop();
    await writeFile(iconDir + "/" + name, data);
    icon.file = name;
  }
  await writeFile(
    resolve(".cache/reference-details.json"),
    JSON.stringify(details, null, 2),
  );
  const measured = await page.evaluate(() => {
    const selectors = {
      menu: '[class*="menu-bar_menu-bar"]',
      tabs: '[class*="gui_tab-list"]',
      categories: ".blocklyToolboxDiv",
      flyout: ".blocklyFlyout",
      workspace: ".injectionDiv",
      stage: '[class*="stage_stage-wrapper"]',
      sprite: '[class*="sprite-selector_sprite-selector"]',
    };
    return Object.fromEntries(
      Object.entries(selectors).map(([name, selector]) => {
        const el = document.querySelector(selector);
        if (!el) return [name, null];
        const b = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return [
          name,
          {
            selector,
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            background: s.backgroundColor,
            font: s.font,
            border: s.border,
            radius: s.borderRadius,
          },
        ];
      }),
    );
  });
  await writeFile(
    out + "/reference.json",
    JSON.stringify(
      {
        commit: "a2946eeb9a9dca7857d7ab53d766b54288c7a2ff",
        viewport: { width: 1280, height: 720 },
        locale: "zh-cn",
        theme: "light/red, default addons",
        build,
        browser: browser.version(),
        measured,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(measured, null, 2));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
