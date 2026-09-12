import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
export const root = resolve(import.meta.dirname, "..");
export const font =
  process.env.MOTION_FONT ||
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf";
export async function serve(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const path =
        url === "/font.ttf"
          ? font
          : resolve(
              root,
              "." +
                (url.startsWith("/source/")
                  ? url.replace("/source/", "/.cache/turbowarp/")
                  : url === "/"
                    ? "/p0/index.html"
                    : url),
            );
      if (path !== font && !path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(path);
      const type =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".json": "application/json",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ttf": "font/ttf",
          ".mp4": "video/mp4",
          ".css": "text/css",
        }[extname(path)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}
