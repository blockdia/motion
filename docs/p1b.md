# P1b：通用教程闭环

已完成（2026-09-12）。P1b 复用 [P1a 的固定编辑器布局](p1a.md)，把 P0 固定时间线扩展为可编译的教程协议。目录与 target 能力已由 [P1c](p1c.md) 扩展，当前支持范围见下表；P2 的常规编辑覆盖与 P3 的观众视口交互尚未实现。

## 复现

需要 Node.js ≥22.18、pnpm、Chrome、FFmpeg，以及 [P0 已构建的固定 Blockly 源码](p0.md)。首次准备依次执行 `pnpm p0:bootstrap`、`pnpm p1a:reference:bootstrap`、`pnpm p1c:bootstrap`。`CHROME_PATH`、`MOTION_FONT` 沿用 P0；浏览器和视频均校验字体 SHA-256，字体文件不随仓库分发。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:integration
pnpm p1b
pnpm preview
```

预览地址为 [本地播放器](http://127.0.0.1:4173/apps/playground/index.html)。`pnpm p1b` 编译示例、检查 JSON 等价性、验证播放/暂停/跳转/释放、生成双端关键帧，并实际调用 CLI 导出视频。产物位于 `artifacts/p1b/`；受版本管理的关键帧和验收数据位于 [p1b-baseline](p1b-baseline/report.json)。P0 预览仍保留在 `/p0/index.html`。

独立使用 CLI：

```sh
pnpm motion check examples/basic-editing/tutorial.json
pnpm motion compile examples/basic-editing/tutorial.ts artifacts/p1b/scene.json
pnpm motion compile examples/basic-editing/tutorial.json artifacts/p1b/scene.json
pnpm motion export artifacts/p1b/scene.json artifacts/p1b/tutorial.mp4 30
```

播放器可用 `?scene=/artifacts/another-scene.json` 读取其他编译产物。命令从仓库根目录运行；当前 CLI 是本地开发入口，不是已发布的独立安装包。JSON 教程不执行代码；TypeScript 入口通过 Node 加载作者模块，仅用于可信作者代码。编译产物包含准备器生成的 SVG/CSS，应作为可信资源包使用。

## 模块与协议

| 包                  | 职责                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| `core`              | `TutorialSpec`、积木图、manifest、场景事件/轨道、诊断和纯 `evaluate(t, compiled)`  |
| `authoring`         | 严格 JSON 校验、TypeScript builder、状态推导、目标解析、并行冲突检查               |
| `adapter-turbowarp` | 固定源码版本；目录定义来自真实编辑器                                               |
| `asset-builder`     | 校验源码/字体、启动临时 Blockly、验证定义/连接/字段、提取 SVG/锚点、释放 workspace |
| `renderer-browser`  | 共享 SVG 呈现与浏览器播放控制；样式和 SVG ID 按播放器隔离                          |
| `renderer-video`    | 使用同一 SVG 呈现，resvg 栅格化、FFmpeg 流式编码与临时文件清理                     |
| `cli`               | catalog / check / compile / export                                                 |

所有包使用 TypeScript 和 pnpm workspace，`tsc -b` 按项目引用构建。核心包不依赖 Blockly、DOM、Node API 或渲染后端。浏览器页面仅加载编译产物、核心求值器与播放器。

`schemaVersion: 1` 的教程 spec 和编译产物分开。编译产物包含带稳定逻辑 ID 的最终积木图、完整栈资源、内部字段/连接锚点、布局、分类条目、节点补丁和半开动画区间。字段提交、连接完成时原子替换资源；输入过程为每个暂态文本准备真实 Blockly 积木栈，并测量原生字段编辑器的尺寸、圆角、边框、文字与阴影；播放时逐帧切换几何并叠加输入框。暂态文字通过编辑器的 setText 路径更新，仅最终提交执行字段校验。

资源清单记录 Blockly/GUI commit、构建文件哈希、字体哈希、语言、布局、主题、结构 SVG 与锚点。准备会收集实际用到的状态，并在同一准备会话内按规范化定义和来源哈希复用资源。当前资源键包含逻辑 ID，跨实例视觉去重、磁盘缓存和完整组合状态缓存留给后续阶段。

## 作者接口

完整的同义示例：[TypeScript](../examples/basic-editing/tutorial.ts) / [JSON](../examples/basic-editing/tutorial.json)。两者都不包含作者坐标或编辑器 selector。

```ts
import { defineTutorial, defaultProject } from '@blockdia-motion/authoring';

const tutorial = defineTutorial({
  schemaVersion: 1,
  adapter: 'turbowarp',
  project: defaultProject(),
  initialTarget: 'sprite',
  viewport: { width: 1280, height: 720 },
  defaults: { theme: 'light', locale: 'zh-CN' },
  build(scene) {
    const start = scene.ref('start');
    return scene.sequence(
      scene.dragFromToolbox('events.event_whenflagclicked.4758c63ad4a847ba', {
        id: start.id,
        to: scene.workspace.slot('main'),
      }),
      scene.dragFromToolbox('motion.motion_movesteps.a5812bf398461387', {
        id: 'move',
        to: start.connection('next'),
      }),
      scene.type(scene.ref('move.STEPS.shadow').field('NUM'), '20', { duration: 0.8 }),
    );
  },
});
```

`defineTutorial` 立即执行 builder 并返回纯数据。`ref` 和 `defineBlocks` 只声明引用/数据；`create`、`paste`、`dragFromToolbox` 才创建实例。手动定义必须显式提供根及所有子积木 ID、受支持的字段与输入；不猜测缺失 shadow 或默认值。重复 ID 必须由作者重新映射。

`dragFromToolbox` 保留源条目，复制完整定义并将子 ID 映射到新实例 ID 下。它自动切换分类（0.25 秒）、必要时滚动（0.25 秒）、移动鼠标到抓取点（0.2 秒），再执行作者设置的拖动时长。条目已经可见时省略切换和滚动。超高条目优先显示可抓取顶部。显式 `toolbox.reveal` 的时长用于滚动，必要的分类切换另计 0.25 秒；无需揭示时不增加时间。

`move` / `connect` 另含 0.2 秒鼠标接近；`type` 另含 0.2 秒字段接近和 0.2 秒鼠标移开。鼠标移开时选中旧值，之后清空并按 Unicode 字素逐步输入；停靠点避开所有中间输入框和阴影。`duration` 均要求有限正数；未传时拖动/创建/粘贴/移动/连接为 1 秒，输入为 0.8 秒，分类/揭示为 0.25 秒。`wait` 必须显式给出时长。`linear` 和 `easeInOut` 为已注册缓动，后者使用 smoothstep；不保存任意回调。

串行片段累计时长，并行片段取最长分支。并行分支从相同的开始状态独立编译，不能引用另一分支尚未创建的实例。对同一积木栈、放置槽、toolbox 或鼠标的交叉访问保守拒绝；多个不同槽上的创建/粘贴可以并行。连接目标也纳入冲突检查，防止布局与逻辑图依赖分支编译顺序。

## P1b 支持范围

| 能力         | 当前契约                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 画面         | P1a 的 1280×720、zh-CN、light 固定布局                                                                                             |
| Toolbox 条目 | 固定编辑器的各 target 完整核心目录；仅接受目录中的完整稳定键                                                                       |
| 手动 opcode  | 从 Blockly 定义/实例获取，无 opcode 白名单；未支持的 mutation 明确报错                                                             |
| 手动输入     | 实际输入名；每槽显式一个 shadow 或 block，Blockly 检查连接类型                                                                     |
| 放置槽       | `main`、`secondary`、`lower`；多个手动根按测量高度纵向排布                                                                         |
| 连接         | 将根栈的 previous 接到已有积木的空 next；可直接拖出连接或单独 `connect`                                                            |
| 移动         | 移动完整根栈；移动已连接子积木需要 P2 拆分，当前报错                                                                               |
| 字段         | `scene.ref('move.STEPS.shadow').field('NUM')`；必须引用实际子积木 ID 与字段名；`type` 仅支持文本输入字段，菜单和颜色编辑报能力诊断 |
| 创建/粘贴    | 显式定义，在步骤开始时瞬间出现；duration 是插入后的停留时间，不提供淡入选项；多个根仅能放到工作区槽，连接目标只接受单根            |
| 时间         | sequence / parallel / wait、正时长、两种缓动；任意时间直接求值                                                                     |
| 播放         | 播放、暂停、跳转、响应式等比画面、播放器释放                                                                                       |
| 导出         | 同一编译 JSON → 无音轨 MP4，默认 30 fps；fps 为 1–120 的整数                                                                       |

未知 opcode、字段、输入及未支持操作会给出诊断。完整目录可见不等于所有教程操作都已支持；mutation、交互式嵌套/拆分/删除、变体主题/语言、观众平移/缩放、输入法与菜单编辑继续属于 P2/P3。

字段委托固定 Blockly 的 `callValidator` / `setValue`，再读取实际值。若被拒绝或规范化，报告请求值、实际值和步骤。这个 scratch-blocks 分支的 `FieldNumber` 在最终字段提交时允许非数字字符串，键盘字符过滤和提交 validator 并不相同；P1b 保留该行为，不添加程序数值语义判断。连接调用该分支的 `checkConnection_` / `connect` 并检查双向实际连接。

## 视觉与验收

主要区域沿用 P1a 的 layout/chrome。P1c 已取消旧的教程条目过滤和单分类页面：完整目录连续滚动，分类标题、标签、按钮、复选框与积木位置来自真实 flyout；分类栏标签来自实际语言结果，滚动条跟随内容范围。角色列表、当前 target 高亮及名称/坐标随教程切换；舞台内容和角色缩略图仍留白。详细对照与限制见 [P1c](p1c.md)。

验收脚本保存初始、toolbox hat、两次拖动、清空输入、输入中、输入完成、粘贴瞬间和最终状态共 9 组浏览器 / resvg PNG。双端每通道平均误差须小于 3（0–255），差异超过 32 的像素比例须低于 2.5%。该检查验证两端一致性；与真实 TurboWarp 的布局依据仍是 P1a 参考图。

P1b 原始基线为 6.4 秒 / 192 帧；P1c 加入完整目录后会重新计算自动分类与滚动时长，当前资源数、时长与帧数以 [report.json](p1b-baseline/report.json) 为准。500 次乱序采样与顺序采样一致，TypeScript、JSON 和 CLI 编译产物一致。真实 Blockly 集成覆盖有效连接、长参数、多根粘贴、未知 opcode、缺失字段、错误类型和缺失连接。单元测试覆盖生命周期、重复 ID、并行冲突、自动揭示、原子切换、资源缺失与时间边界。额外的原生输入框回归将短数字和长数字与独立 Blockly HTML 输入框截图对照，结果保存到 `artifacts/input-regression/`。最终记录见 [report.json](p1b-baseline/report.json)。

视频采样 `i / fps`，不包含教程终点；帧数为 `ceil(duration × fps)`，浮点表示噪声在计数时消除。不能整除时编码时长向上补至一个帧间隔，报告分别记录教程时长与编码时长。缺失资源或字体不匹配在导出前失败，编码失败清理临时文件，已有目标视频在成功前不被替换。

仍沿用 P0 的逐帧整张 SVG → resvg 路线，未实现静态图层栅格缓存。报告将素材准备、合成、导出总耗时和 Node 采样峰值 RSS 分开记录；这些是本机验收数据，不是服务器容量承诺，也不包含编码器独立峰值 RSS。P4 再做缓存、取消、并发和容量预算。
