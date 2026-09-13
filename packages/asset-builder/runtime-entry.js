import { createSession } from './modules/asset-builder/session.js';
import { compilePrepared } from './modules/authoring/compiler.js';
import { parseBundle } from './modules/authoring/bundle-schema.js';
window.prepareTutorial = async (input, options) => {
  const bundle = parseBundle(input);
  const adapter = await createSession({
    project: bundle.tutorial.project,
    ...bundle.tutorial.defaults,
    ...options,
  });
  try {
    return await compilePrepared(bundle.tutorial, adapter, bundle.typing);
  } finally {
    await adapter.dispose();
  }
};
window.prepareCatalog = async (options) => {
  const adapter = await createSession(options);
  try {
    return adapter.manifest;
  } finally {
    await adapter.dispose();
  }
};
window.createPreparationSession = createSession;
