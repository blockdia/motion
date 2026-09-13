import type { Manifest } from '@blockdia-motion/core';

// Semantic colours extracted from the pinned Theme API during preparation.
// Fallbacks render pre-P3 light manifests; dark manifests require extracted appearance.
export const guiColor = (m: Manifest, key: string, fallback: string): string =>
  m.appearance?.gui[key] ?? fallback;
export const blockColor = (m: Manifest, key: string, fallback: string): string =>
  m.appearance?.blocks[key] ?? fallback;
