import { mkdir, writeFile } from 'node:fs/promises';
import { targetProject } from '../tests/fixtures/target-project.mjs';
import { defineTutorial } from '../packages/authoring/dist/index.js';
import { bundleTutorial } from '../packages/authoring/dist/bundle.js';
import { createAdapter } from '../packages/asset-builder/dist/index.js';
const project = targetProject(),
  out = 'artifacts/targets';
await mkdir(out, { recursive: true });
const adapter = await createAdapter({ project });
try {
  const tutorial = defineTutorial({
    schemaVersion: 1,
    adapter: 'turbowarp',
    viewport: { width: 1280, height: 720 },
    defaults: { theme: 'light', locale: 'zh-CN' },
    project,
    initialTarget: 'stage',
    build(s) {
      const steps = [];
      for (const target of project.targets) {
        steps.push(s.selectTarget(target.id));
        for (const category of ['motion', 'control', 'myBlocks'])
          steps.push(s.toolbox.selectCategory(category, 0.1), s.wait(0.2));
        if (!target.isStage) {
          const opcode = target.id === 'sprite' ? 'motion_turnright' : 'control_wait';
          const entry = adapter.manifest.targets[target.id].toolbox.find(
            (e) => e.definition.opcode === opcode,
          );
          steps.push(
            s.dragFromToolbox(entry.key, {
              id: target.id + '.example',
              to: s.workspace.slot('main'),
              duration: 0.3,
            }),
            s.wait(0.1),
          );
        }
      }
      steps.push(s.selectTarget('sprite'), s.wait(0.2));
      return steps;
    },
  });
  await writeFile(out + '/tutorial.json', JSON.stringify(await bundleTutorial(tutorial)));
} finally {
  await adapter.dispose();
}
