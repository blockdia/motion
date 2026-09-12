import { defaultProject, defineTutorial } from '@blockdia-motion/authoring';
export default defineTutorial({
  schemaVersion: 1,
  adapter: 'turbowarp',
  project: defaultProject(),
  initialTarget: 'sprite',
  viewport: { width: 1280, height: 720 },
  defaults: { theme: 'light', locale: 'zh-CN' },
  build(scene) {
    const start = scene.ref('start'),
      move = scene.ref('move');
    const note = scene.defineBlocks([
      {
        id: 'note',
        opcode: 'looks_say',
        inputs: {
          MESSAGE: {
            shadow: {
              id: 'note.message',
              opcode: 'text',
              fields: { TEXT: '手动粘贴' },
            },
          },
        },
      },
    ]);
    return scene.sequence(
      scene.wait(0.3),
      scene.dragFromToolbox('events.event_whenflagclicked.4758c63ad4a847ba', {
        id: start.id,
        to: scene.workspace.slot('main'),
        duration: 1.1,
      }),
      scene.dragFromToolbox('motion.motion_movesteps.a5812bf398461387', {
        id: move.id,
        to: start.connection('next'),
        duration: 1.1,
      }),
      scene.type(scene.ref('move.STEPS.shadow').field('NUM'), '20', { duration: 0.7 }),
      scene.parallel(
        scene.paste(note, {
          to: scene.workspace.slot('secondary'),
          duration: 0.5,
        }),
        scene.wait(0.7),
      ),
      scene.move('note', scene.workspace.slot('lower'), { duration: 0.6 }),
      scene.wait(0.4),
    );
  },
});
