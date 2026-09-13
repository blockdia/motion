import {
  type TutorialBundle,
  type Manifest,
  type FontOptions,
  type CompiledScene,
} from '@blockdia-motion/core';
export interface PreparationOptions {
  runtimeUrl: string;
  font: FontOptions;
  layout: Manifest['layout'];
  signal: AbortSignal;
}
/** Each preparation owns a separate realm; fonts, globals and Blockly IDs never leak between players. */
export async function prepareInBrowser(
  bundle: TutorialBundle,
  options: PreparationOptions,
): Promise<CompiledScene> {
  options.signal.throwIfAborted();
  const url = new URL('prepare.html', options.runtimeUrl);
  if (url.origin !== location.origin) throw Error('Preparation runtime must be same-origin');
  const iframe = document.createElement('iframe');
  iframe.dataset.motionPreparation = '';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText =
    'position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;visibility:hidden';
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      iframe.remove();
      reject(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    options.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(Error('Preparation runtime could not load'));
    });
    iframe.src = url.href;
    document.body.append(iframe);
    await Promise.race([loaded, cancelled]);
    const frame = iframe.contentWindow as Window & {
      prepareTutorial?: (
        b: TutorialBundle,
        o: { font: FontOptions; layout: Manifest['layout'] },
      ) => Promise<CompiledScene>;
    };
    if (!frame.prepareTutorial) throw Error('Missing preparation runtime; run runtime:build');
    return structuredClone(
      await Promise.race([
        frame.prepareTutorial(bundle, { font: options.font, layout: options.layout }),
        cancelled,
      ]),
    );
  } finally {
    options.signal.removeEventListener('abort', abort);
    iframe.onload = null;
    iframe.onerror = null;
    iframe.remove();
  }
}
