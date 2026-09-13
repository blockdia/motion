import { layout as l, theme as baseline, rectAttributes as attrs } from "./layout.mjs";
import { chromeLayout } from "./chrome-layout.mjs";
export { shellLabels } from "./chrome-layout.mjs";
import { icons } from "./icons.mjs";
const box = (r, fill, extra = "") =>
  `<rect ${attrs(r)} fill="${fill}" ${extra}/>`;
const rawText = (x, y, value, size = 12, fill = baseline.text) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${value}</text>`;
export function chrome({
  toolboxHeadings = true,
  availableCategories = null,
  toolboxScrollbar = true,
  targetPanel = false,
  locale = "zh-CN",
  measurements,
  appearance,
} = {}) {
  const gui = (key, fallback) => appearance?.gui[key] ?? fallback;
  const block = (key, fallback) => appearance?.blocks[key] ?? fallback;
  const c = { ...baseline, accent: gui('looks-secondary', baseline.accent), background: gui('ui-primary', baseline.background), panel: gui('ui-white', baseline.panel), tertiary: gui('ui-tertiary', baseline.tertiary), text: gui('text-primary', baseline.text), border: gui('ui-black-transparent', baseline.border), scrollbar: block('scrollbar', baseline.scrollbar), grid: block('gridColor', baseline.grid), toolbox: block('flyout', baseline.toolbox) };
  const input = (x, y, width, height = 32) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${gui('input-background', 'white')}" stroke="${c.border}"/>`;
  const geometry = chromeLayout(locale, measurements);
  const { translate: t, menu, title, project, feedback, tabs, search } = geometry;
  const movedIcons = Object.fromEntries(Object.entries(icons).map(([key, value]) => [key, { ...value }]));
  for (const item of menu) {
    movedIcons[item.icon].x = item.x;
    if (item.caret) movedIcons[`caret-${item.icon}`].x = item.caretX;
  }
  movedIcons['project-page'].x = project.x + 12;
  for (const tab of tabs) movedIcons[tab.icon].x = tab.x + 21;
  const text = (x, y, value, size = 12, fill = c.text) => {
    const end = { 角色: 824, 显示: 824, 大小: 968, 方向: 1108 }[value];
    if (end) return rawText(end, y, t(value), size, fill).replace('<text ', '<text text-anchor="end" ');
    if (['舞台', '背景'].includes(value)) return rawText(1236, y, t(value), size, fill).replace('<text ', '<text text-anchor="middle" ');
    return rawText(x, y, t(value), size, fill);
  };
  const categories = [
    ["运动", "#4c97ff"],
    ["外观", "#9966ff"],
    ["声音", "#cf63cf"],
    ["事件", "#ffbf00"],
    ["控制", "#ffab19"],
    ["侦测", "#5cb1d6"],
    ["运算", "#59c059"],
    ["变量", "#ff8c1a"],
    ["自制积木", "#ff6680"],
  ];
  return (
    box({ x: 0, y: 0, width: l.width, height: l.height }, c.background) +
    box(l.menu, gui('menu-bar-background', c.accent), 'data-surface="menu"') +
    `<g font-weight="bold">${menu.map(item => `<g data-shell-menu="${item.icon}">${text(item.textX, 28, item.label, 12, 'white')}</g>`).join('')}</g>` +
    `<path data-shell-region="menu-divider" d="M${title.x - 9} 7 V41" fill="none" stroke="${c.border}" stroke-dasharray="3 2"/>` +
    `<g data-shell-region="project-title"><rect x="${title.x}" y="8" width="${title.width}" height="32" rx="3" fill="${gui('project-title-inactive', 'rgba(255,255,255,.2)')}"/>${text(title.x + 10, 28, 'Motion 教程', 12, 'white')}</g>` +
    `<g data-shell-region="project-page"><rect x="${project.x}" y="8" width="${project.width}" height="32" rx="3" fill="none" stroke="${c.border}"/>${text(project.x + 40, 28, '查看作品页面', 12, 'white')}</g>` +
    `<g data-shell-region="feedback"><rect x="${feedback.x}" y="8" width="${feedback.width}" height="32" rx="3" fill="white"/>${text(feedback.x + 11, 28, 'TurboWarp 反馈', 12, gui('menu-bar-background', c.accent))}</g>` +
    tabs.map((tab, i) => `<g data-shell-tab="${tab.icon}"><path d="M${tab.x} 92 V${i ? 73 : 69} Q${tab.x} ${i ? 58 : 53} ${tab.x + 16} ${i ? 58 : 53} H${tab.x + tab.width - 18} Q${tab.x + tab.width} ${i ? 58 : 53} ${tab.x + tab.width} 74 V92Z" fill="${i ? c.tertiary : c.panel}" stroke="${c.border}"/>${text(tab.x + 45, 79, tab.label, 12, i ? c.text : c.accent)}</g>`).reverse().join('') +
    `<g data-shell-region="search"><rect x="${search.x}" y="59" width="${search.width}" height="23" rx="3" fill="${gui('input-background', 'white')}" stroke="${c.border}"/>${text(search.x + 6, 75, '查找（Ctrl+F）', 12, c.text)}</g>` +
    box(l.workspace, block('workspace', c.toolbox), `data-surface="workspace" stroke="${c.border}" rx="8"`) +
    `<defs><pattern id="workspace-dots" x="311" y="93" width="27" height="27" patternUnits="userSpaceOnUse"><circle cx="13" cy="13" r=".7" fill="${c.grid}"/></pattern></defs>` +
    box(l.workspace, "url(#workspace-dots)") +
    '<g data-slot="workspace"></g>' +
    box(l.toolbox, c.toolbox, `data-surface="flyout" stroke="${c.border}" fill-opacity=".8"`) +
    box(l.categories, c.panel, `data-surface="category" stroke="${c.border}"`) +
    categories
      .map(([name, color], i) =>
        availableCategories && !availableCategories.includes(name)
          ? ""
          : `<circle cx="31" cy="${109 + i * 49}" r="9.5" fill="${color}" stroke="${color}"/>${text(name.length > 2 ? 10 : 21, 132 + i * 49, name, 10.4)}`,
      )
      .join("") +
    `<rect x="0" y="630" width="62" height="53" fill="${c.accent}"/><rect x="0" y="692" width="781" height="28" rx="7" fill="${c.panel}" stroke="${c.border}"/>${text(378, 710, "书包", 14)}` +
    (toolboxHeadings
      ? text(69, 122, "事件", 12) + text(69, 222, "运动", 12)
      : "") +
    (toolboxScrollbar ? `<rect x="300" y="96" width="6" height="53" rx="3" fill="${c.scrollbar}"/>` : "") + `<rect x="774" y="383" width="6" height="289" rx="3" fill="${c.scrollbar}"/><rect x="541" y="675" width="230" height="6" rx="3" fill="${c.scrollbar}"/>` +
    `<defs><filter id="zoom-theme" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter></defs>` +
    [0, 1, 2]
      .map(
        (i) =>
          `<g data-view-action="${["in", "out", "reset"][i]}" role="button" tabindex="0" aria-label="${t(["放大", "缩小", "恢复视角"][i])}" style="cursor:pointer" ${block('zoomIconFilter', 'none') === 'invert(100%)' ? 'filter="url(#zoom-theme)"' : ''}><title>${t(["放大", "缩小", "恢复视角"][i])}</title><circle cx="742" cy="${555 + i * 44}" r="17" fill="white" stroke="#d9d9d9" stroke-width="2"/>` +
          (i < 2
            ? `<circle cx="741" cy="${554 + i * 44}" r="7" fill="none" stroke="#8790a6" stroke-width="1.5"/><path d="M746 ${560 + i * 44} l4 4 M737 ${554 + i * 44} h8 ${i === 0 ? `M741 ${550 + i * 44} v8` : ""}" fill="none" stroke="#8790a6" stroke-width="1.5"/>`
            : `<path d="M737 640 H747 M737 646 H747" stroke="#8790a6" stroke-width="1.5"/>`) + "</g>",
      )
      .join("") +
    `<rect x="1167" y="53" width="34" height="34" rx="3" fill="${c.panel}" stroke="${c.border}"/><rect x="1201" y="53" width="34" height="34" fill="${gui('looks-light-transparent', '#ffe5e5')}" stroke="${c.border}"/><rect x="1239" y="53" width="33" height="34" rx="3" fill="${c.panel}" stroke="${c.border}"/>` +
    box(l.stage, "white", `data-surface="stage" stroke="${c.border}" rx="4"`) +
    box(l.sprites, gui('ui-secondary', '#e9f1fc'), `stroke="${c.border}" rx="8"`) +
    `<path d="M791 563 V470 Q791 463 798 463 H1184 Q1191 463 1191 470 V563Z" fill="${c.panel}"/><path d="M790 564 H1192" stroke="${c.border}"/>` +
    box(l.backdrop, c.panel, `stroke="${c.border}" rx="8"`) +
    text(803, 496, "角色", 10) +
    text(1008, 496, "x", 10) +
    text(1118, 496, "y", 10) +
    input(832, 476, 127) +
    input(1021, 476, 47) +
    input(1132, 476, 47) +
    text(803, 538, "显示", 10) +
    text(947, 538, "大小", 10) +
    text(1084, 538, "方向", 10) +
    input(976, 518, 64) +
    input(1116, 518, 63) +
    (targetPanel ? `<defs>${["show", "hide"].map(name => { const im = icons[name]; return `<g id="target-${name}-icon"><image ${attrs(im)} href="${im.uri}"/></g>`; }).join("")}</defs>` : `<rect x="832" y="518" width="33" height="32" rx="3" fill="${gui('looks-light-transparent', '#ffe5e5')}" stroke="${c.border}"/><rect x="865" y="518" width="33" height="32" rx="3" fill="${gui('input-background', 'white')}" stroke="${c.border}"/>`) +
    text(1226, 489, "舞台", 10) +
    `<rect x="1204" y="509" width="64" height="48" rx="3" fill="${c.panel}" stroke="${c.border}"/>` +
    text(1226, 580, "背景", 10) +
    '<g data-slot="targets"></g>' +
    `<circle cx="1153" cy="686" r="24" fill="${c.accent}" stroke="${gui('looks-transparent', '#ffb5b5')}" stroke-width="4"/><circle cx="1236" cy="686" r="24" fill="${c.accent}" stroke="${gui('looks-transparent', '#ffb5b5')}" stroke-width="4"/>` +
    Object.entries(movedIcons)
      .filter(([name]) => !targetPanel || !["show", "hide"].includes(name))
      .map(
        ([name, im]) =>
          `<image data-ui="${name}" ${attrs(im)} href="${im.uri}"${name === "stop" ? ' opacity=".5"' : ""}/>`,
      )
      .join("")
  );
}
