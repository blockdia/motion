import { defineTutorial, defaultProject } from '@blockdia-motion/authoring';
export default defineTutorial({
  schemaVersion: 1,
  adapter: 'turbowarp',
  project: defaultProject(),
  initialTarget: 'sprite',
  viewport: { width: 1280, height: 720 },
  defaults: { theme: 'light', locale: 'zh-CN' },
  build(s) {
    return s.sequence(
      s.create(
        [
          {
            id: 'repeat',
            opcode: 'control_repeat',
            inputs: {
              TIMES: {
                shadow: { id: 'times', opcode: 'math_whole_number', fields: { NUM: '10' } },
              },
            },
          },
        ],
        { to: s.workspace.slot('main'), duration: 0.2 },
      ),
      s.create(
        [
          {
            id: 'say',
            opcode: 'looks_say',
            inputs: {
              MESSAGE: { shadow: { id: 'message', opcode: 'text', fields: { TEXT: '你好' } } },
            },
          },
        ],
        { to: s.workspace.slot('secondary'), duration: 0.2 },
      ),
      s.connect('say', { kind: 'connection', id: 'repeat', name: 'SUBSTACK' }, { duration: 0.5 }),
      s.type(s.ref('message').field('TEXT'), '你好，欢迎学习积木编程'),
      s.highlight('say', 0.3),
      s.wait(0.4),
      s.split('say', s.workspace.slot('secondary'), { duration: 0.5 }),
      s.type(s.ref('message').field('TEXT'), '你好'),
      s.annotate('say', '从容器中拆出后仍保留文本', 0.4),
      s.delete('say', 0.4),
      s.create(
        [
          {
            id: 'reporter',
            opcode: 'operator_add',
            inputs: {
              NUM1: { shadow: { id: 'n1', opcode: 'math_number', fields: { NUM: '1' } } },
              NUM2: { shadow: { id: 'n2', opcode: 'math_number', fields: { NUM: '2' } } },
            },
          },
        ],
        { to: s.workspace.slot('secondary'), duration: 0.2 },
      ),
      s.connect('reporter', { kind: 'connection', id: 'repeat', name: 'TIMES' }, { duration: 0.5 }),
      s.wait(0.6),
      s.split('reporter', s.workspace.slot('secondary'), { duration: 0.5 }),
      s.delete('reporter', 0.3),
      s.create(
        [{ id: 'rotation', opcode: 'motion_setrotationstyle', fields: { STYLE: 'all around' } }],
        { to: s.workspace.slot('secondary'), duration: 0.2 },
      ),
      s.choose(s.ref('rotation').field('STYLE'), 'left-right', 0.5),
      s.setField(s.ref('times').field('NUM'), '20', { duration: 0.2 }),
      s.wait(0.3),
    );
  },
});
