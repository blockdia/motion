import { createShell, createSceneRenderer, loadNativeShell } from './dom.js';
import type { CompiledScene, Rect } from '@blockdia-motion/core';
import type { RenderOptions } from './dom.js';
/** Cached DOM layer capture. The Node compositor handles frame transforms and clipping. */
export async function createExportCapture(
  scene: CompiledScene,
  runtimeUrl: string,
  ratio: number,
  options: RenderOptions,
) {
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px';
  document.body.append(container);
  const shell = createShell(
    container,
    scene.manifest.fontFamily!,
    scene.manifest.locale,
    await loadNativeShell(runtimeUrl, scene.manifest.locale, scene.manifest.colorTheme ?? 'light'),
  );
  shell.root.style.transform = `scale(${ratio})`;
  const renderer = createSceneRenderer(shell, scene);
  const isolate = document.createElement('style');
  shell.root.append(isolate);
  let cleanups: (() => void)[] = [];
  const reset = () => {
    isolate.textContent = '';
    for (const f of cleanups) f();
    cleanups = [];
  };
  const rect = (e: Element, padding = 0): Rect => {
    const r = e.getBoundingClientRect();
    const x = Math.max(0, Math.floor(r.x - padding * ratio)),
      y = Math.max(0, Math.floor(r.y - padding * ratio));
    return {
      x,
      y,
      width: Math.min(1280 * ratio, Math.ceil(r.right + padding * ratio)) - x,
      height: Math.min(720 * ratio, Math.ceil(r.bottom + padding * ratio)) - y,
    };
  };
  const only = (e: HTMLElement) => {
    e.dataset.exportCapture = '';
    isolate.textContent = `#${shell.scope},#${shell.scope} *{visibility:hidden!important} #${shell.scope} [data-export-capture],#${shell.scope} [data-export-capture] *{visibility:visible!important}`;
    cleanups.push(() => delete e.dataset.exportCapture);
  };
  function prepare(time: number, kind: string, index = 0) {
    reset();
    renderer.draw(time, { x: 0, y: 0, zoom: 1 }, options);
    if (kind === 'base') {
      const hide = [
        shell.world,
        shell.toolbox.parentElement!,
        shell.dragWorld.parentElement!,
        shell.overlays.parentElement!,
        shell.cursor,
        shell.targets,
        shell.categories,
        shell.properties,
        shell.backdrop,
        shell.root.querySelector<HTMLElement>('[data-view-action]')!.parentElement!,
      ];
      for (const e of hide) {
        const prior = e.style.visibility;
        e.style.visibility = 'hidden';
        cleanups.push(() => (e.style.visibility = prior));
      }
      return rect(shell.root);
    }
    if (kind === 'flyout') {
      only(shell.toolbox.parentElement!);
      for (const child of shell.toolbox.parentElement!.children) {
        const e = child as HTMLElement,
          prior = e.style.display;
        e.style.display = 'none';
        cleanups.push(() => (e.style.display = prior));
      }
      return rect(shell.toolbox.parentElement!);
    }
    if (kind === 'controls') {
      const e = shell.root.querySelector<HTMLElement>('[data-view-action]')!.parentElement!;
      only(e);
      const boxes = Array.from(e.querySelectorAll<HTMLElement>('[data-view-action]')).map(
        (button) => rect(button),
      );
      const x = Math.min(...boxes.map((r) => r.x)),
        y = Math.min(...boxes.map((r) => r.y));
      return {
        x,
        y,
        width: Math.max(...boxes.map((r) => r.x + r.width)) - x,
        height: Math.max(...boxes.map((r) => r.y + r.height)) - y,
      };
    }
    if (kind === 'categories' || kind === 'properties' || kind === 'backdrop') {
      const e = shell[kind];
      only(e);
      return rect(e, 2);
    }
    if (kind === 'card') {
      const holder = shell.targets.children[index] as HTMLElement;
      only(holder);
      const prior = holder.style.cssText,
        parent = shell.targets.parentElement!,
        overflow = parent.style.overflow;
      parent.style.overflow = 'visible';
      holder.style.left = '0px';
      holder.style.top = '0px';
      cleanups.push(() => {
        holder.style.cssText = prior;
        parent.style.overflow = overflow;
      });
      return rect(holder, 12);
    }
    if (kind === 'decoration') {
      const e = shell.toolbox.querySelector<HTMLElement>('[data-decorations]')!.children[
        index
      ] as HTMLElement;
      only(e);
      const parent = e.parentElement!,
        transform = parent.style.transform,
        prior = e.style.top;
      parent.style.transform = '';
      e.style.top = '0px';
      const flyout = shell.toolbox.parentElement!,
        overflow = flyout.style.overflow;
      flyout.style.overflow = 'visible';
      cleanups.push(() => {
        parent.style.transform = transform;
        e.style.top = prior;
        flyout.style.overflow = overflow;
      });
      return rect(e, 2);
    }
    if (kind === 'scrollbar') {
      const e = shell.toolbox.parentElement!.querySelector<HTMLElement>(
        '[data-toolbox-scrollbar]',
      )!;
      only(e);
      const prior = e.style.top;
      e.style.top = '0px';
      cleanups.push(() => (e.style.top = prior));
      return rect(e);
    }
    if (kind === 'overlay') {
      const e = Array.from(shell.overlays.querySelectorAll<HTMLElement>('[data-layer]')).filter(
        (e) => !e.hidden,
      )[index]!;
      only(e);
      return rect(e, 12);
    }
    throw Error('Unknown capture layer');
  }
  return {
    prepare,
    async media(time: number): Promise<{ png: string; rect: Rect } | null> {
      reset();
      await (window as any).player.renderAt(time);
      const video = document.querySelector<HTMLVideoElement>('#player video:not([hidden])');
      if (!video) return null;
      const r = video.getBoundingClientRect(),
        canvas = document.createElement('canvas');
      canvas.width = Math.round(r.width);
      canvas.height = Math.round(r.height);
      const fit = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight),
        width = video.videoWidth * fit,
        height = video.videoHeight * fit;
      canvas
        .getContext('2d')!
        .drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      return {
        png: canvas.toDataURL('image/png').split(',')[1]!,
        rect: { x: r.x, y: r.y, width: canvas.width, height: canvas.height },
      };
    },
    dispose() {
      reset();
      renderer.dispose();
      container.remove();
    },
  };
}
