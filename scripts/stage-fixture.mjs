import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('artifacts/media', { recursive: true });
// Solid one-second red, green and blue segments make frame identity testable without fonts.
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=480x360:r=30:d=1',
    '-f',
    'lavfi',
    '-i',
    'color=c=lime:s=480x360:r=30:d=1',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=480x360:r=30:d=1',
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map',
    '[v]',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '15',
    '-movflags',
    '+faststart',
    'artifacts/media/stage.mp4',
  ],
  { stdio: 'pipe' },
);
