import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import type { Rect } from '@blockdia-motion/core';
export interface Bitmap {
  surface: Canvas;
  width: number;
  height: number;
  byteLength: number;
  /** Readback for quality checks; production composition retains only the native surface. */
  readonly pixels: Buffer;
  rect?: Rect;
}
export function createBitmap(width: number, height: number): Bitmap {
  const surface = createCanvas(width, height);
  return {
    surface,
    width,
    height,
    byteLength: width * height * 4,
    get pixels() {
      return surface.data();
    },
  };
}
export async function bitmapFromPng(png: Buffer, width: number, height: number): Promise<Bitmap> {
  const image = await loadImage(png);
  if (image.width !== width || image.height !== height) throw Error('Unexpected bitmap dimensions');
  const bitmap = createBitmap(width, height);
  bitmap.surface.getContext('2d').drawImage(image, 0, 0);
  return bitmap;
}
/** Export-local LRU of native raster surfaces; bytes count retained RGBA pixels. */
export class BitmapCache {
  private entries = new Map<string, Bitmap>();
  bytes = 0;
  peakBytes = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
  constructor(readonly limit: number) {}
  get(key: string) {
    const value = this.entries.get(key);
    if (value) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, value);
    } else this.misses++;
    return value;
  }
  set(key: string, value: Bitmap) {
    if (value.byteLength > this.limit) return;
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.byteLength;
      this.entries.delete(key);
    }
    while (this.bytes + value.byteLength > this.limit) {
      const first = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(first)!.byteLength;
      this.entries.delete(first);
      this.evictions++;
    }
    this.entries.set(key, value);
    this.bytes += value.byteLength;
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
/** Skia performs sampling and alpha blending; JS only supplies drawing parameters. */
export function blit(
  frame: Canvas,
  width: number,
  height: number,
  image: Bitmap,
  x: number,
  y: number,
  clip: Rect = { x: 0, y: 0, width, height },
  opacity = 1,
  rotation = 0,
  pivotX = 0,
  pivotY = 0,
  scale = 1,
) {
  const ctx = frame.getContext('2d');
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.width, clip.height);
    ctx.clip();
    ctx.translate(x + pivotX, y + pivotY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(image.surface, -pivotX, -pivotY);
  } finally {
    ctx.restore();
  }
}
