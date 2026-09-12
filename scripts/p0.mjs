import { chromium } from "playwright-core";
import { Resvg } from "@resvg/resvg-js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { serve, font, root } from "./server.mjs";
import {
  frameSvg,
  chrome,
  WIDTH,
  HEIGHT,
  FPS,
  DURATION,
} from "../p0/scene.mjs";
const out = root + "/artifacts";
await mkdir(out, { recursive: true });
const build = JSON.parse(
  await readFile(root + "/.cache/turbowarp/build.json", "utf8"),
);
if (build.commit !== "7c58de666658df1bb447d010132aa3914c10f41e")
  throw Error("Unexpected source commit");
for (const [file, hash] of Object.entries(build.files))
  if (
    createHash("sha256")
      .update(await readFile(root + "/.cache/turbowarp/" + file))
      .digest("hex") !== hash
  )
    throw Error(`Build hash mismatch: ${file}`);
let browser;
const start = performance.now();
const report = {
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fontSha256: createHash("sha256")
      .update(await readFile(font))
      .digest("hex"),
    ffmpeg: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split(
      "\n",
    )[0],
  },
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  duration: DURATION,
  frameCount: FPS * DURATION,
};
const raster = (svg) =>
  new Resvg(svg, {
    font: {
      fontFiles: [font],
      loadSystemFonts: false,
      defaultFontFamily: "Motion Sans",
    },
  })
    .render()
    .asPng();
const server = await serve();
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  report.environment.chromium = browser.version();
  report.sourceBuild = build;
  const cdp = await browser.newBrowserCDPSession();
  async function sampleBrowserRss() {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    const rss = execFileSync(
      "ps",
      ["-o", "rss=", "-p", processInfo.map((p) => p.id).join(",")],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .reduce((sum, n) => sum + Number(n) * 1024, 0);
    report.browserSampledPeakRssBytes = Math.max(
      report.browserSampledPeakRssBytes || 0,
      rss,
    );
  }
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => console.error(e));
  await page.goto(server.url + "/p0/prepare.html");
  await sampleBrowserRss();
  const assets = await page.evaluate(() => window.prepare());
  report.workspaceDisposed = await page.evaluate(
    () => window.workspaceDisposed,
  );
  if (!report.workspaceDisposed) throw Error("Workspace not disposed");
  report.preparationMs = performance.now() - start;
  await sampleBrowserRss();
  assets.schemaVersion = 0;
  assets.source = {
    repository: "https://github.com/TurboWarp/scratch-blocks",
    commit: "7c58de666658df1bb447d010132aa3914c10f41e",
  };
  report.validation = assets.validation;
  await writeFile(out + "/manifest.json", JSON.stringify(assets, null, 2));
  await writeFile(out + "/theme.css", assets.theme);
  await writeFile(
    out + "/chrome.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><g font-family="Motion Sans">${chrome()}</g></svg>`,
  );
  const connected = assets.resources.stack20.anchors;
  if (
    Math.hypot(
      connected.start.connections.next.x -
        connected.move.connections.previous.x,
      connected.start.connections.next.y -
        connected.move.connections.previous.y,
    ) > 0.01
  )
    throw Error("Misaligned connection");
  report.keyframeComparison = [];
  for (const [key, a] of Object.entries(assets.resources)) {
    await writeFile(
      `${out}/${key}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${a.box.x - 2} ${a.box.y - 2} ${a.box.width + 4} ${a.box.height + 4}">${a.content}</svg>`,
    );
  }
  // A fresh page has never loaded Blockly: playback cannot depend on its globals or DOM.
  await page.goto(server.url);
  await page.waitForFunction(() => window.ready);
  report.playerHasBlockly = await page.evaluate(
    () => typeof window.Blockly !== "undefined",
  );
  if (report.playerHasBlockly) throw Error("Blockly leaked into player");
  for (const [t, name, gallery] of [
    [1.2, "drag-hat", false],
    [3.2, "drag-move", false],
    [4.2, "connected10", false],
    [6, "connected20", false],
    [6, "gallery", true],
  ]) {
    await page.evaluate(([time, g]) => window.renderAt(time, g), [t, gallery]);
    await page
      .locator("#frame")
      .screenshot({ path: `${out}/browser-${name}.png` });
    await writeFile(
      `${out}/video-${name}.png`,
      raster(frameSvg(t, assets, { gallery })),
    );
    const difference = await page.evaluate(async (name) => {
      async function pixels(prefix) {
        const image = new Image();
        image.src = `/artifacts/${prefix}-${name}.png`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const a = await pixels("browser"),
        b = await pixels("video");
      if (a.length !== b.length) throw Error("Different image dimensions");
      let sum = 0,
        changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        let max = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          sum += d;
          max = Math.max(max, d);
        }
        if (max > 32) changed++;
      }
      return {
        meanChannelError: sum / ((a.length / 4) * 3),
        changedPixelRatio: changed / (a.length / 4),
      };
    }, name);
    report.keyframeComparison.push({ name, ...difference });
    if (difference.meanChannelError > 3 || difference.changedPixelRatio > 0.025)
      throw Error(`Keyframe mismatch: ${name} ${JSON.stringify(difference)}`);
  }
  await sampleBrowserRss();
  await cdp.detach();
  await browser.close();
  browser = null;
  const exportStart = performance.now();
  let composeMs = 0,
    backpressureMs = 0,
    peakRss = process.memoryUsage().rss;
  const encoderArgs = [
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-framerate",
    String(FPS),
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out + "/p0.mp4",
  ];
  const measured = process.platform === "darwin";
  const encoder = spawn(
    measured ? "/usr/bin/time" : "ffmpeg",
    measured ? ["-l", "ffmpeg", ...encoderArgs] : encoderArgs,
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let errors = "";
  encoder.stderr.on("data", (d) => {
    errors = (errors + d).slice(-6000);
  });
  const done = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) =>
      code === 0 ? resolve() : reject(Error(errors)),
    );
  });
  // Attach an immediate rejection handler; await the same promise after ending stdin.
  done.catch(() => {});
  encoder.stdin.on("error", () => {});
  try {
    for (let i = 0; i < FPS * DURATION; i++) {
      const before = performance.now(),
        png = raster(frameSvg(i / FPS, assets));
      composeMs += performance.now() - before;
      const waitStart = performance.now();
      if (!encoder.stdin.write(png))
        await Promise.race([
          once(encoder.stdin, "drain"),
          done.then(() => {
            throw Error("Encoder exited early");
          }),
        ]);
      backpressureMs += performance.now() - waitStart;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    encoder.stdin.end();
    const flush = performance.now();
    await done;
    report.encoderFlushMs = performance.now() - flush;
  } catch (error) {
    encoder.kill();
    throw error;
  }
  if (measured) {
    report.encoderPeakRssBytes = Number(
      errors.match(/(\d+)\s+maximum resident set size/)?.[1],
    );
    const cpu = errors.match(/([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys/);
    report.encoderCpuSeconds = cpu ? Number(cpu[2]) + Number(cpu[3]) : null;
  }
  report.exportWallMs = performance.now() - exportStart;
  report.compositionMs = composeMs;
  report.pipeAndBackpressureMs = backpressureMs;
  report.nodePeakRssBytes = peakRss;
  report.processMaxRssBytes = process.resourceUsage().maxRSS * 1024;
  report.videoProbe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,nb_read_frames,duration",
        "-of",
        "json",
        out + "/p0.mp4",
      ],
      { encoding: "utf8" },
    ),
  );
  if (Number(report.videoProbe.streams[0].nb_read_frames) !== FPS * DURATION)
    throw Error("Wrong frame count");
  report.totalMs = performance.now() - start;
  await writeFile(out + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  await server.close();
}
