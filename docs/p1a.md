# P1a：编辑器布局与样式基线

P1a 已实现。默认画布为 1280×720、简体中文、TurboWarp light/red 主题。此阶段仍沿用 P0 固定教程，不提供 P1b 的通用协议、自动切换分类或作者 API。

## 真实来源与复现

参考 GUI 来自 `a2946eeb9a9dca7857d7ab53d766b54288c7a2ff`，从相邻 scratch-gui 的 git 对象提取到 `.cache/gui`，使用该快照自己的 package-lock.json 安装依赖；没有使用当前 Blockdia checkout 的构建产物或依赖软链接。默认插件配置保持上游默认值，因此顶栏实际包含 Settings、文件、编辑、插件、高级及查找框。参考页面是 `/editor.html?locale=zh-cn`，Chrome 视口 1280×720、deviceScaleFactor=1、全新浏览器上下文。

```sh
# 在 motion 根目录运行；只在首次建立或重新采集真实参考时需要：
pnpm p1a:reference:bootstrap
pnpm p1a:reference
# 仅在有意更新模板图标时运行：
node scripts/extract-icons.mjs

# 常规验证使用仓库内已保存的参考测量，无需重新构建整个 GUI：
pnpm p0:bootstrap
pnpm test
pnpm p1a
pnpm preview
```

参考构建需要网络和 npm；可用 `TURBOWARP_GUI` 指定提供固定 git 对象的 checkout。积木准备仍使用 P0 的固定 scratch-blocks `7c58de6…`；GUI lockfile 中的 scratch-blocks 是 `4113c53…`，两者来源分别记录，不声称完全相同版本。视觉检查确认此示例的积木比例一致。Chrome、字体和 FFmpeg 的配置方式沿用 [P0](p0.md)。

[参考测量](p1a-baseline/reference.json) 记录 GUI commit、锁文件哈希、浏览器版本、语言、主题、实际 DOM 区域和选择器。选择器只存在于参考采集脚本，不进入播放器或教程。原始图标来自固定 GUI 页面，整理为 `adapters/turbowarp/icons.mjs` 的内嵌 SVG 资源；无外部请求。参考采集的中间图标和 DOM 明细留在忽略跟踪的 `.cache` 中。

## 布局与实现

| 区域 | 参考位置 / 尺寸（px） | Motion |
| --- | --- | --- |
| 顶栏 | 0,0 / 1280×48 | 相同 |
| 标签与控制行 | y=48，高44；编辑器宽782 | 相同 |
| 分类栏 | 1,93 / 61×538（含边框） | 60×537 内容框，误差不超过1 px |
| Toolbox | 61,93 / 251×591（含边框） | 250×590 内容框 |
| 编辑器容器 | 0,92 / 782×591 | 工作区裁剪 311,93 / 470×589 |
| 舞台 | 790,92 / 482×362 | 相同，内部留白 |
| 角色面板 | 790,462 / 402×258 | 相同，保留控件占位 |
| 背景面板 | x=1200，宽72 | 保留位置与空白缩略图 |
| 书包 | y=692 至720 | 保留底部折叠条 |

`adapters/turbowarp/layout.mjs` 集中定义区域、颜色令牌、积木比例、命名工作区位置、toolbox 抓取起点和 UI 锚点。`chrome.mjs` 是根据真实画面与源码整理的受控 SVG 模板，两端共享。区域描边、圆角、27 px 点阵、滚动条、缩放按钮、分类与控件间距均按基准整理。图标使用原始矢量，不以 Unicode 字符代替。颜色来自 `src/lib/themes/gui/light.js` 与 `accent/red.js`，尺寸参考 `src/css/units.css`、`gui.css`、`blocks.css` 和运行时测量。

素材保持原始 Blockly 几何；呈现缩放为参考 flyout 实测的 **0.675**。连接点与字段中心使用相同比例变换。拖动副本使用跨区裁剪，toolbox 和工作区使用各自区域裁剪；连接后的栈仍原子切换。资源 manifest 和验证报告保存 GUI 来源、布局、主题与锚点，方便 P1b 继续使用。

## 图像验收与允许差异

[真实 TurboWarp](p1a-baseline/reference.png) · [Motion 初始浏览器画面](p1a-baseline/browser-initial.png) · [Motion 最终浏览器画面](p1a-baseline/browser-connected20.png) · [同时间视频画面](p1a-baseline/video-connected20.png)

人工对照确认主要区域比例、字体层级、分类密度、积木比例、图标与基础样式符合基准；绿色旗帜、暂停、停止图标按原 DOM 的内容区大小（20 px）呈现。

明确保留以下简化：

- 不运行项目；舞台、角色列表、角色属性值及背景内容留白，保留区域、表单外形和入口图标。参考页面中的默认角色不作为 Motion 素材。
- Toolbox 仅保留教程需要的事件帽与移动积木，按讲解顺序展示两个紧凑分类片段；保留全部常规分类按钮作为静态外壳，不实现分类交互或完整积木目录。P1b 负责条目揭示与分类时间线。
- 顶栏作品名称为 Motion 教程；菜单、查找、书包、舞台与角色控件均为静态呈现，不可操作。播放器控制栏位于逻辑画布外。
- 使用与 P0 相同、显式加载的 Motion Sans（本机 Arial Unicode）统一浏览器和视频字体；真实 GUI 使用 Helvetica/Arial 系列及系统中文回退。字体笔画、文本宽度、少量粗细、阴影与抗锯齿允许小差异，不要求像素复刻。
- 工作区滚动条为受控静态位置，省略空工作区角色水印；颜色主题切换与通用 DOM 提取不属于本阶段。图标中的主题颜色已按本次默认主题解析。

没有把双端像素接近当成真实 GUI 对齐的证明：前者由自动比较检查，后者依据独立的参考图、区域测量和上述人工对照。

## 验证

`pnpm p1a` 首先将 adapter 区域与保存的真实测量比较，允许边框造成的 1 px 差异；随后准备素材、销毁 workspace、验证无 Blockly 播放，比较初始/拖帽/拖移动/连接10/连接20及素材总览共6组双端画面，再导出7秒、30 fps、210帧的无音轨 MP4。5组教程画面的两端 PNG 与完整报告保存到本目录；视频保存在 `artifacts/p0.mp4`。

单元测试覆盖乱序求值、原子连接、缺失资源、缩放后的拖动起点、字段光标与裁剪边界。实测数据见 [P1a 报告](p1a-baseline/report.json)。当前仍逐帧合成完整 SVG；本阶段没有实现栅格缓存或提出新的性能预算。
