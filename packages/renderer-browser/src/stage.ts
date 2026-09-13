import type { StageClip } from '@blockdia-motion/core';
function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
        cleanup();
        resolve();
      },
      error = () => {
        cleanup();
        reject(Error('Video load/decode failed: ' + video.currentSrc));
      },
      abort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
    const timer = setTimeout(() => {
      cleanup();
      reject(Error('Video timed out: ' + video.currentSrc));
    }, 15000);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener('error', error);
      signal.removeEventListener('abort', abort);
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', error, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export async function createStage(
  host: HTMLElement,
  clips: StageClip[],
  base: string,
  signal: AbortSignal,
) {
  const entries: { clip: StageClip; video: HTMLVideoElement }[] = [];
  function dispose() {
    for (const { video } of entries) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
    entries.length = 0;
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    for (const clip of clips) {
      signal.throwIfAborted();
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain';
      video.hidden = true;
      entries.push({ clip, video });
      host.append(video);
      const loaded = waitFor(video, 'loadeddata', signal);
      video.src = new URL(clip.src, base).href;
      await loaded;
      if (!Number.isFinite(video.duration) || clip.in + clip.duration > video.duration + 0.001)
        throw Error('Stage clip exceeds media duration: ' + clip.src);
    }
  } catch (error) {
    dispose();
    signal.removeEventListener('abort', dispose);
    throw error;
  }
  let sequence = 0;
  return {
    async renderAt(time: number, playing = false) {
      const token = ++sequence;
      for (const { clip, video } of entries) {
        const active = time >= clip.start && time < clip.start + clip.duration;
        video.hidden = !active;
        if (!active) {
          video.pause();
          continue;
        }
        if (video.error) throw Error('Video decode failed: ' + clip.src);
        const target = clip.in + time - clip.start;
        if (!playing) video.pause();
        if (Math.abs(video.currentTime - target) > (playing ? 0.12 : 1e-5)) {
          video.pause();
          const sought = waitFor(video, 'seeked', signal);
          video.currentTime = target;
          await sought;
        }
        if (token !== sequence) return;
        if (video.readyState < 3) await waitFor(video, 'canplay', signal);
        if (token !== sequence) return;
        if (playing) await video.play();
      }
    },
    pause() {
      sequence++;
      for (const { video } of entries) video.pause();
    },
    dispose() {
      sequence++;
      signal.removeEventListener('abort', dispose);
      dispose();
    },
  };
}
