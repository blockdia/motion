// The pinned GUI uses content widths, 8px menu gaps, and 20px tab padding.
// Measure the bundled font during preparation; the renderer only consumes geometry.
export const english = {
  放大: 'Zoom in',
  缩小: 'Zoom out',
  恢复视角: 'Reset view',
  文件: 'File',
  编辑: 'Edit',
  插件: 'Addons',
  高级: 'Advanced',
  'Motion 教程': 'Motion tutorial',
  查看作品页面: 'See Project Page',
  'TurboWarp 反馈': 'TurboWarp Feedback',
  代码: 'Code',
  造型: 'Costumes',
  声音: 'Sounds',
  '查找（Ctrl+F）': 'Find (Ctrl+F)',
  书包: 'Backpack',
  角色: 'Sprite',
  显示: 'Show',
  大小: 'Size',
  方向: 'Direction',
  舞台: 'Stage',
  背景: 'Backdrops',
};
export const shellLabels = ['Settings', ...Object.keys(english), ...Object.values(english)];
export function chromeLayout(locale, measurements = {}) {
  const translate = (value) => (locale === 'en' ? (english[value] ?? value) : value);
  const width = (value, size = 12, weight = 'normal') => {
    const label = translate(value);
    return (
      measurements[`${weight}:${size}:${label}`] ??
      [...label].reduce((n, char) => n + (/[^\x00-\x7f]/.test(char) ? size : size * 0.6), 0)
    );
  };
  let x = 8;
  const menu = ['Settings', '文件', '编辑', '插件', '高级'].map((label, i) => {
    const item = {
      label,
      x,
      textX: x + 24,
      textWidth: width(label, 12, 'bold'),
      icon: ['settings', 'file', 'edit', 'addons', 'advanced'][i],
    };
    item.caretX = item.textX + item.textWidth + 8;
    item.caret = i < 3;
    x = item.caret ? item.caretX + 8 + 24 : item.textX + item.textWidth + 28;
    return item;
  });
  const title = { x: Math.ceil(x), width: Math.max(191, width('Motion 教程', 12, 'bold') + 20) };
  const project = {
    x: title.x + title.width + 9,
    width: Math.max(124, width('查看作品页面', 12, 'bold') + 52),
  };
  const feedback = {
    x: project.x + project.width + 9,
    width: Math.max(112, width('TurboWarp 反馈', 12, 'bold') + 22),
  };
  x = 0;
  const tabs = ['代码', '造型', '声音'].map((label, i) => {
    const tab = {
      label,
      x,
      width: Math.ceil(66 + width(label)),
      icon: ['code', 'costume', 'sound'][i],
    };
    x += tab.width - 8;
    return tab;
  });
  const search = { x: x + 24, width: Math.max(197, width('查找（Ctrl+F）') + 12) };
  return { translate, menu, title, project, feedback, tabs, search };
}
