import { defaultProject } from '../../packages/core/dist/index.js';
export function targetProject() {
  const project = defaultProject();
  project.targets[0].variables = [
    { id: 'global-score', name: '分数', type: '' },
    { id: 'global-list', name: '记录', type: 'list' },
    { id: 'broadcast-ready', name: '准备', type: 'broadcast_msg' },
  ];
  project.targets[1].variables = [{ id: 'local-a', name: '甲的速度', type: '' }];
  project.targets[1].x = 37;
  project.targets[1].y = -24;
  project.targets[1].costumes = ['甲造型1', '甲造型2'];
  project.targets[1].sounds = ['甲声音'];
  project.targets[1].procedures = [
    {
      code: '前进 %s',
      argumentIds: ['distance'],
      argumentNames: ['距离'],
      argumentDefaults: ['10'],
      warp: false,
    },
  ];
  project.targets.push({
    ...structuredClone(project.targets[1]),
    id: 'sprite-b',
    name: '角色乙',
    x: -19,
    y: 58,
    costumes: ['乙造型'],
    sounds: ['乙声音'],
    variables: [{ id: 'local-b', name: '乙的速度', type: '' }],
    procedures: [],
  });
  return project;
}
