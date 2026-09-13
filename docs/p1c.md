> 历史设计与验收记录。当前发布格式、播放器和导出链路见 [客户端渲染迁移](client-rendering.md) 与 [API](api.md)。

# P1c：Target 上下文与完整 toolbox

已完成。教程现在显式声明项目与初始 target，准备器为每个 target 生成固定 TurboWarp 的完整核心 toolbox。编译器、纯求值器、浏览器和视频共同消费同一份目录与资源；播放时没有 Blockly workspace 或 VM。

## 复现与目录发现

在 P0 的 Node.js、Chrome、FFmpeg 和字体环境上，增加固定 GUI 的源码与依赖。`TURBOWARP_GUI` 可覆盖相邻 `scratch-gui` 路径。

```sh
pnpm install --frozen-lockfile
pnpm p0:bootstrap
pnpm p1a:reference:bootstrap
pnpm p1c:bootstrap
pnpm build
pnpm test
pnpm test:integration
pnpm p1b
pnpm p1c
pnpm preview
```

`p1c:bootstrap` 打包准备专用的 GUI/VM 数据桥，不构建另一个播放器。它验证 GUI lockfile，并将实际引用的 GUI 源文件与固定 commit 对照；构建记录包含全部输入文件和 bundle 的 SHA-256。之后每次准备都会验证这些输入，发生变化时要求重新生成。

```sh
pnpm motion catalog examples/basic-editing/tutorial.json artifacts/catalog.json
pnpm motion compile examples/basic-editing/tutorial.ts artifacts/p1b/scene.json
pnpm motion export artifacts/p1b/scene.json artifacts/p1b/tutorial.mp4 30
```

`catalog` 输出包含完整定义、能力信息、字段选项和 SVG 的 manifest。作者从 `targets[targetId].toolbox` 获取真实条目键，再用于 `dragFromToolbox`。无需为新增普通 opcode 修改业务代码。`p1c` 会保存三 target 教程、编译产物、视频和报告到 `artifacts/p1c/`；浏览器使用 `?scene=/artifacts/p1c/scene.json` 预览。

## 项目、target 和时间线

教程必须提供 `project` 与 `initialTarget`。`defaultProject()` 是显式的空项目构建器：舞台和一个角色、各一个命名的背景/造型、空变量/声音/自定义积木列表。它不会由 adapter 自动补入。

```ts
import { defineTutorial, defaultProject } from '@blockdia-motion/authoring';

const project = defaultProject();
project.targets[1].variables.push({ id: 'speed', name: '速度', type: '' });

const tutorial = defineTutorial({
  schemaVersion: 1,
  adapter: 'turbowarp',
  viewport: { width: 1280, height: 720 },
  defaults: { theme: 'light', locale: 'zh-CN' },
  project,
  initialTarget: 'sprite',
  build: (s) =>
    s.sequence(s.selectTarget('stage'), s.wait(0.5), s.selectTarget('sprite'), s.wait(0.5)),
});
```

每个 target 声明稳定 ID、名称、舞台标记、初始 x/y、造型/背景及声音名称、变量/列表/广播、自定义积木签名。舞台必须位于第一项且只有一个；变量 ID 在项目内唯一。资源名称只参与 toolbox 默认值和选项，不加载舞台媒体，也不执行项目。

`selectTarget` 是零时长的原子切换。每个可视节点记录 `targetId`，切换后恢复该 target 的工作区积木和 toolbox 分类/滚动位置。P1b 工作区摄像机仍固定，观众平移缩放属于 P3。积木实例 ID 保持教程全局唯一；引用必须属于当前 target，跨 target 连接或移动报 `TARGET_SCOPE`。并行分支中切换 target 报 `PARALLEL_CONFLICT`，要求显式串行。

编译产物仅通过 `finalTargets` 保存分 target 的最终积木图；manifest 的目录只位于 `targets`，没有另一个单角色目录。旧 P1b spec 需补充这两个项目字段；仓库的 TypeScript/JSON 示例已同步，旧编译文件需要重新编译。

## 真实提取入口

GUI 固定为 `a2946eeb9a9dca7857d7ab53d766b54288c7a2ff`，积木素材沿用 P0 的 scratch-blocks `7c58de666658df1bb447d010132aa3914c10f41e`。VM 使用该 GUI lockfile 锁定的 `c4823421cb7c17d8d8a89878851ce1668c26a21f`。

准备桥复用 GUI 的 `src/lib/make-toolbox-xml.js`、`src/lib/blocks.js`，以及 VM 的 Runtime、Sprite、Blocks 和 XML adapter。先设置真实编辑 target，再调用 `runtime.getBlocksXML(target)` 和 GUI toolbox 构建函数。变量/列表分类由 Blockly 的动态分类生成器展开，自定义积木分类由真实 procedure prototype 生成。VM 只提供数据模型，不启动时钟、渲染器、音频或程序执行。

真实 flyout 负责全目录排版：分类顺序、标题、标签、按钮、监视器复选框、积木坐标和滚动范围均提取自它。分隔空白通过实际测量的位置保留，原始 toolbox XML 也保存在目录中。分类栏标签由 Blockly 消息替换得到，分类行间距和命名工作区放置槽来自受控布局配置。

`Blockly.Xml.blockToDom` 提供默认字段、shadow、嵌套输入和 mutation；实际字段对象提供字段类型及动态选项，实际连接对象提供锚点。依赖其他输入的菜单还会同步到 VM 的 Blocks 数据，避免“某角色的属性”菜单停留在构建时的空状态。位置默认值遵循 GUI 的 target 更新逻辑。

条目键为 `分类.opcode.完整规范化定义的SHA256前16位`。相同 opcode 的不同变量、参数或 mutation 使用不同键；完全相同的重复定义按原目录出现次序追加序号。逻辑子 ID 使用结构路径，不使用 Blockly 的随机实例 ID。教程必须使用目录中返回的完整 `key`；不接受旧短键或 opcode 代替条目身份。

固定 Blockly 会随机生成颜色字段默认值和部分内部 ID。准备环境使用记录在 manifest 中的种子 `0x4d6f7469`，通过原有生成逻辑取样；独立真实 GUI 对照验证颜色字段结构，其随机具体颜色不做相等断言。重新启动准备浏览器仍得到相同目录。

## 能力与缓存边界

| 范围               | 当前行为                                                                                |
| ------------------ | --------------------------------------------------------------------------------------- |
| 可发现与可显示     | 支持配置下的全部核心分类、积木、动态变量/列表、自定义积木调用及控件，不按教程引用过滤   |
| 拖出与手动创建     | 无 mutation 且现有操作可表达的真实定义；字段与连接由 Blockly 验证，不维护 opcode 白名单 |
| 文本输入           | 实际子积木 ID 与字段名；菜单、颜色和其他字段编辑报 `CAPABILITY`                         |
| mutation           | 完整保留并准备目录视觉；工作区 mutation 操作及拖出暂不支持，明确报 `CAPABILITY`         |
| 编辑器隐式变量     | 可显示真实默认条目；若其引用未在项目声明，拖出提示先显式声明，避免复制未知变量          |
| 连接与组合         | 根栈 next 连接及手动子树；交互式替换输入、拆分、删除继续留给 P2                         |
| 扩展与动态项目修改 | 不支持扩展或附加组件配置、运行时新增 target/变量/过程；这些字段或操作不会被静默忽略     |

`capability.prepare` 表示目录资源已准备，`capability.drag` 表示当前可拖出；不能据目录可见推断所有操作都已支持。若 Blockly 无法保留声明变量的身份，例如同一作用域发生不受支持的同名冲突，准备失败而非合并数据。

完整目录资源在准备阶段全部生成；浏览器和视频只绘制与当前可视范围相交的节点，内容、顺序和滚动范围不变。工作区变体仍按需求准备。同一会话缓存键包含协议、GUI/Blockly/VM 来源、准备代码/布局哈希、浏览器版本、字体、语言、完整项目上下文、当前 target、定义及输入状态。项目改名或局部数据改变会失效；编译器拒绝使用不同项目准备的 adapter。

当前没有跨进程磁盘资源缓存，也不承诺跨实例视觉去重或所有项目规模下的性能。导出仍为共享场景 SVG → resvg → FFmpeg，P4 再处理静态栅格缓存与容量预算。

## 验收证据

`tests/integration/catalog.test.mjs` 覆盖舞台及两个局部数据不同的角色、同 opcode 不同定义身份、造型选项、位置默认值、过程 mutation、JSON/TypeScript 等价、未知条目、字段/能力诊断、跨 target 连接、局部变量隔离、切换恢复、乱序求值、全新浏览器重生成与上下文失效。原 catalog 外的 `motion_turnright` 和 `control_wait` 直接提取、拖出并导出，无新增白名单。

`scripts/p1c-reference.mjs` 独立启动完整固定 GUI，关闭改变下拉菜单的 `rename-broadcasts`、`editor-searchable-dropdowns` 两个附加组件以匹配核心菜单配置，保留 P1a 的其他默认视觉设置，载入相同项目，等待实际 toolbox 更新完成，对照所有分类、条目顺序、完整默认定义、动态选项、mutation、分类滚动位置和条目位置。验收项目分别包含 **83 / 123 / 122** 个条目，每个 target 都有 9 个分类。原生参考截图覆盖各 target 的首部、中部和尾部，见 [reference.json](p1c-baseline/reference.json)。

`scripts/p1c.mjs` 在 workspace 释放后生成同样区域及切换恢复后的 10 组浏览器/resvg 关键帧，按 P1b 阈值检查一致性，并导出 4.6 秒 / 138 帧 / 1280×720 / 30 fps 视频、核对 ffprobe 帧数，见 [report.json](p1c-baseline/report.json)。各组双端图像的实际差异记录在报告中，按 P1b 的平均通道误差与差异像素比例阈值验收。`scripts/p1b.mjs` 同时回归原教程、CLI、输入动画、播放控制、随机跳转及视频导出。

角色列表按项目顺序显示全部角色，使用固定 GUI 的卡片尺寸、五列布局与红色选中样式；`selectTarget` 同步切换角色或舞台高亮、当前角色名称和坐标，背景数量来自舞台的造型元数据。多行列表根据当前 target 确定滚动位置，让选中卡片避开底部添加按钮；长名称显示省略号，完整名称保留在 SVG 标题中。任意跳转无需依赖先前滚动历史。仅舞台项目显示空列表。

角色列表由浏览器和视频共享的 SVG 渲染器绘制；不提供观众点击切换、新增、删除或重排角色。项目协议目前只声明造型名称，没有图片资源，因此舞台内容与卡片缩略图留白，角色大小、方向和可见性由项目中的 `size`、`direction`、`visible` 显式提供；`defaultProject()` 默认分别为 100、90、true。位置、大小和方向与原版一样取整显示。选中舞台时属性控件禁用：名称与坐标显示“名字 / x / y”占位，大小和方向为空，显示/隐藏按钮均为灰色且不选中。旧 JSON 项目需要补齐这三个字段再编译。`scripts/p1c.mjs` 检查每个关键帧的列表顺序和唯一选中项，并保存 15 个角色与长名称的双端截图；单元测试覆盖跳转恢复、名称转义与仅舞台项目。

P1a 的顶栏、标签页、区域比例和留白保持不变。允许差异还包括受控按钮/复选框绘制、确定性的分类滚动时长。真实 GUI 的参考项目含过程定义与保留广播的种子脚本，只用于验证目录上下文，不属于 Motion 教程的初始工作区。

目录键可通过 `motion catalog <tutorial.json|tutorial.ts> <catalog.json>` 查询；从目录拖出的子积木 ID 将 `entry` 前缀替换为步骤指定的根 ID，例如 `entry.STEPS.shadow` 变成 `move.STEPS.shadow`，对应字段为 `NUM`。手动创建的积木使用作者显式声明的子 ID。历史教程需改用这些实际引用后重新编译。
