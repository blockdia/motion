import type { Manifest } from '@blockdia-motion/core';

// Semantic colours extracted from the pinned Theme API during preparation.
// Geometry-only light manifests may omit appearance; dark manifests require extracted colors.
export const guiColor = (m: Manifest, key: string, fallback: string): string =>
  m.appearance?.gui[key] ?? fallback;
export const blockColor = (m: Manifest, key: string, fallback: string): string =>
  m.appearance?.blocks[key] ?? fallback;
