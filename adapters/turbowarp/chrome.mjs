import { layout as l, theme as c, rectAttributes as attrs } from "./layout.mjs";
import { icons } from "./icons.mjs";
const box = (r, fill, extra = "") =>
  `<rect ${attrs(r)} fill="${fill}" ${extra}/>`;
const text = (x, y, value, size = 12, fill = c.text) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${value}</text>`;
const input = (x, y, width, height = 32) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="white" stroke="#d4d4d4"/>`;
export function chrome({
  toolboxHeadings = true,
  availableCategories = null,
  toolboxScrollbar = true,
  targetPanel = false,
} = {}) {
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
    box(l.menu, c.accent) +
    `<g font-weight="bold">${text(32, 28, "Settings", 12, "white")}${text(143, 28, "文件", 12, "white")}${text(227, 28, "编辑", 12, "white")}${text(311, 28, "插件", 12, "white")}${text(387, 28, "高级", 12, "white")}</g>` +
    `<rect x="440" y="8" width="191" height="32" rx="3" fill="white" opacity=".2"/><rect x="640" y="8" width="124" height="32" rx="3" fill="none" stroke="#dc4141"/><rect x="773" y="8" width="112" height="32" rx="3" fill="white"/>` +
    text(450, 28, "Motion 教程", 12, "white") +
    text(680, 28, "查看作品页面", 12, "white") +
    text(784, 28, "TurboWarp 反馈", 12, c.accent) +
    ["代码", "造型", "声音"]
      .map(
        (name, i) =>
          `<path d="M${i * 82} 92 V${i ? 73 : 69} Q${i * 82} ${i ? 58 : 53} ${i * 82 + 16} ${i ? 58 : 53} H${i * 82 + 72} Q${i * 82 + 90} ${i ? 58 : 53} ${i * 82 + 90} 74 V92Z" fill="${i ? c.tertiary : c.panel}" stroke="${c.border}"/>${text(i * 82 + 45, 79, name, 12, i ? c.text : c.accent)}`,
      )
      .reverse()
      .join("") +
    `<rect x="271" y="59" width="197" height="23" rx="3" fill="white" stroke="#d4d4d4"/>${text(277, 75, "查找（Ctrl+F）", 12, "#777777")}` +
    box(l.workspace, c.toolbox, `stroke="${c.border}" rx="8"`) +
    `<defs><pattern id="workspace-dots" x="311" y="93" width="27" height="27" patternUnits="userSpaceOnUse"><circle cx="13" cy="13" r=".7" fill="${c.grid}"/></pattern></defs>` +
    box(l.workspace, "url(#workspace-dots)") +
    '<g data-slot="workspace"></g>' +
    box(l.toolbox, c.toolbox, `stroke="${c.border}" fill-opacity=".8"`) +
    box(l.categories, c.panel, `stroke="${c.border}"`) +
    categories
      .map(([name, color], i) =>
        availableCategories && !availableCategories.includes(name)
          ? ""
          : `<circle cx="31" cy="${109 + i * 49}" r="9.5" fill="${color}" stroke="${color}"/>${text(name.length > 2 ? 10 : 21, 132 + i * 49, name, 10.4)}`,
      )
      .join("") +
    `<rect x="0" y="630" width="62" height="53" fill="${c.accent}"/><rect x="0" y="692" width="781" height="28" rx="7" fill="white" stroke="#d4d4d4"/>${text(378, 710, "书包", 14)}` +
    (toolboxHeadings
      ? text(69, 122, "事件", 12) + text(69, 222, "运动", 12)
      : "") +
    (toolboxScrollbar ? `<rect x="300" y="96" width="6" height="53" rx="3" fill="${c.scrollbar}"/>` : "") + `<rect x="774" y="383" width="6" height="289" rx="3" fill="${c.scrollbar}"/><rect x="541" y="675" width="230" height="6" rx="3" fill="${c.scrollbar}"/>` +
    [0, 1, 2]
      .map(
        (i) =>
          `<circle cx="742" cy="${555 + i * 44}" r="17" fill="white" stroke="#d9d9d9" stroke-width="2"/>` +
          (i < 2
            ? `<circle cx="741" cy="${554 + i * 44}" r="7" fill="none" stroke="#8790a6" stroke-width="1.5"/><path d="M746 ${560 + i * 44} l4 4 M737 ${554 + i * 44} h8 ${i === 0 ? `M741 ${550 + i * 44} v8` : ""}" fill="none" stroke="#8790a6" stroke-width="1.5"/>`
            : `<path d="M737 640 H747 M737 646 H747" stroke="#8790a6" stroke-width="1.5"/>`),
      )
      .join("") +
    `<rect x="1167" y="53" width="34" height="34" rx="3" fill="white" stroke="#d4d4d4"/><rect x="1201" y="53" width="34" height="34" fill="#ffe5e5" stroke="#d4d4d4"/><rect x="1239" y="53" width="33" height="34" rx="3" fill="white" stroke="#d4d4d4"/>` +
    box(l.stage, c.panel, `stroke="${c.border}" rx="4"`) +
    box(l.sprites, "#e9f1fc", `stroke="${c.border}" rx="8"`) +
    `<path d="M791 563 V470 Q791 463 798 463 H1184 Q1191 463 1191 470 V563Z" fill="white"/><path d="M790 564 H1192" stroke="#d4d4d4"/>` +
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
    (targetPanel ? `<defs>${["show", "hide"].map(name => { const im = icons[name]; return `<g id="target-${name}-icon"><image ${attrs(im)} href="${im.uri}"/></g>`; }).join("")}</defs>` : `<rect x="832" y="518" width="33" height="32" rx="3" fill="#ffe5e5" stroke="#d4d4d4"/><rect x="865" y="518" width="33" height="32" rx="3" fill="white" stroke="#d4d4d4"/>`) +
    text(1226, 489, "舞台", 10) +
    `<rect x="1204" y="509" width="64" height="48" rx="3" fill="white" stroke="#d4d4d4"/>` +
    text(1226, 580, "背景", 10) +
    '<g data-slot="targets"></g>' +
    `<circle cx="1153" cy="686" r="24" fill="${c.accent}" stroke="#ffb5b5" stroke-width="4"/><circle cx="1236" cy="686" r="24" fill="${c.accent}" stroke="#ffb5b5" stroke-width="4"/>` +
    Object.entries(icons)
      .filter(([name]) => !targetPanel || !["show", "hide"].includes(name))
      .map(
        ([name, im]) =>
          `<image data-ui="${name}" ${attrs(im)} href="${im.uri}"${name === "stop" ? ' opacity=".5"' : ""}/>`,
      )
      .join("")
  );
}
