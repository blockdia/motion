import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
export const root = resolve(import.meta.dirname, '..');
// P0 historical tools may opt in via MOTION_FONT; current export passes a font explicitly.
export const font = process.env.MOTION_FONT;
export async function serve(port = 0, options = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const path =
        url === '/font.ttf'
          ? options.font || font
          : resolve(
              root,
              '.' +
                (url.startsWith('/source/')
                  ? url.replace('/source/', '/.cache/turbowarp/')
                  : url === '/'
                    ? '/p0/index.html'
                    : url),
            );
      if (path !== font && path !== options.font && !path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(path);
      const type =
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.mjs': 'text/javascript',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ttf': 'font/ttf',
          '.mp4': 'video/mp4',
          '.css': 'text/css',
        }[extname(path)] || 'application/octet-stream';
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        if (start > end || start >= data.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': data.length,
          'Accept-Ranges': 'bytes',
        });
        res.end(data);
      }
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}
