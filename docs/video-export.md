# 视频导出与性能

当前默认路线为 Chrome UI 图层截图缓存 → resvg SVG 素材缓存 → @napi-rs/canvas（Skia）原生图片合成 → RGBA 帧 → FFmpeg。`backend: 'screenshot'` 保留整场 Chrome 截图作为参考。Blockly/VM 只参与素材准备，随后销毁；两种后端都使用确定性时间 `i / fps`，不运行 Scratch 项目。

## 合成实现

- 默认 1280×720、30 fps、并发 1、32 MiB 动态图层 LRU、FFmpeg 2 线程。原生合成依赖固定版本 `@napi-rs/canvas@1.0.9`。支持偶数 16:9 尺寸（最多 4K）、1–120 fps、1–4 并发及 0–256 MiB 缓存。固定逻辑画布整体缩放。
- Chrome 保留一个页面，用真实 HTML/CSS 捕获透明局部 UI：分类栏按 target/分类缓存，属性和背景选择器按 target 缓存，角色卡片按角色/选中状态缓存，输入框、菜单、IME、高亮和标注按完整状态缓存。发生变化时只捕获相关图层。字体、主题、比例固定于同一次导出。
- SVG 以视觉内容和边界寻址，排除没有参与主题选择的语义 `data-id`，重复课程的相同外观可以复用。resvg 用明确指定的字体栅格化；普通积木与拖拽阴影分别缓存。缓存命中不再次栅格化；超出字节预算后按 LRU 淘汰，需要时重建。无跨导出的持久缓存。
- 固定背景、透明飞出栏底色、控件和光标只准备一次，另计 `fixedLayerBytes`。动态缓存预算按原生表面的 RGBA 像素字节量计算。可复用帧表面池、独立 RGBA 输出队列及原生分配器开销另计；预算并不是整个导出进程的内存限额。`cacheBytes: 0` 关闭动态缓存，固定图层仍保留。
- 每帧求值并按播放器层级拼接，处理 workspace/toolbox/角色列表裁剪、透明度、滚动和拖拽。裁剪、透明度、亚像素位移和光标旋转/缩放交给 Skia 的 Canvas 2D，JavaScript 只提供绘制参数。UI PNG 和 resvg PNG 在缓存未命中时解码上传一次，命中时直接绘制原生表面；resvg 与 Chrome 的字体/边缘抗锯齿会有小差异，需要视觉误差预算。
- 有舞台片段时精确跳转并等待浏览器视频帧，只取舞台像素，保持静音、裁剪与等比例容纳。视频像素逐帧读取，UI/SVG 缓存继续生效；此路径仍有浏览器解码、舞台 PNG 传输与解码开销。
- 有界批次最多保留 `concurrency` 帧，严格按帧序写入 rawvideo。UI 捕获/媒体操作串行化，异步素材栅格化可以重叠；原生绘制复用帧表面，最终读取独立 RGBA Buffer；绘制调用没有额外工作线程。默认并发 1，不能将提高并发理解为相应的 CPU 倍增。
- `stdin.write` 返回 false 后停止生产并等待 drain；不预生成完整视频。取消和异常中断浏览器及 drain，移除逐操作取消监听，关闭 Chrome、等待 FFmpeg 并删除临时文件。成功后原子替换输出。API、CLI 和进度回调见 [API](api.md#导出选项与取消)。

截图后端使用独立并发页面及按整场 DOM 摘要寻址的 PNG 帧 LRU；有舞台视频时关闭整帧缓存。该路径继续用于浏览器参考与画面回归。

## 可复现比较

```sh
pnpm benchmark:compare /absolute/path/font.ttf
# 不运行长教程：
pnpm benchmark:compare /absolute/path/font.ttf --quick
# 截图性能矩阵与两次长视频回归：
pnpm benchmark:export /absolute/path/font.ttf
```

比较脚本输出 `artifacts/export-comparison/report.json`、语义教程及两种 MP4。各案例共用同一 bundle、字体、尺寸、fps、32 MiB 缓存预算、并发 1 与编码线程 2，在同一 Node 进程中串行执行，每次重新启动 Chrome。Node/Rust 分配器保留内存可能影响后续 RSS。缓存预算相同但内容格式不同，合成版固定图层另计。记录 Node/OS/CPU、Chrome、FFmpeg、字体及源码 SHA-256；ffprobe 实际解码检查帧数、尺寸及单视频轨，每个案例均匀抽取 9 个解码 RGB 帧比较。

长教程包含五次完整 all-api 操作与间隔，覆盖中文输入、菜单、连接/拆分/删除和 target 切换。完整脚本还在同一 Node 中重复合成长教程，检查首/中/末解码帧摘要及 512 MiB 峰值增长预算。每次 Chrome 冷启动的顺序固定为截图后端再合成后端，数字为单次本机测量，存在系统调度、字体准备和热缓存波动。

## 指标口径和预算

`preparationMs` 包括 Chrome/静态服务启动、外壳、字体、素材及播放器准备，合成版还包括场景桥接和固定图层捕获。`preparation[]` 记录每页素材准备、资源数量和 SVG 内容字节数。

`compositionMs` 为生成各批帧的壁钟总和；`compositionWorkerMs` 是批内任务耗时之和，不能与前者相加。`layers` 分别报告 UI 捕获次数/耗时、SVG 栅格次数/耗时、原生绘制耗时、帧读回耗时及舞台读取次数/耗时。SVG 耗时包括 resvg 栅格化、PNG 中转及原生表面上传；UI 耗时也包括其 PNG 解码上传。`surfacePoolPeakFrames` / `surfacePoolPeakBytes` 记录可复用帧表面的数量和像素字节峰值，输出 Buffer 队列另计。其中固定图层捕获发生在准备阶段，其他捕获/栅格发生在合成阶段，不能将全部子项再与阶段总耗时相加。并发时子项可能重叠。

`pipeAndBackpressureMs` 为写入和背压等待。RGBA 不压缩，管道流量及队列占用通常大于 PNG；省去了逐帧整场截图、PNG 编码和 FFmpeg PNG 解码。`encoding` 来自 FFmpeg `-benchmark` 的 user/system CPU 和 wall，wall 包括等待输入；`encoderFlushMs` 仅为结束输入后的等待。合成和编码重叠，`exportMs` 是准备至成功替换输出的端到端耗时，不包含最终关闭 Chrome。

FFmpeg maxrss 不纳入报告：当前源码将 getrusage 的 ru_maxrss 按 KiB 处理，在 macOS 上与系统字节单位不一致，参见 [FFmpeg 实现](https://www.ffmpeg.org/doxygen/trunk/ffmpeg_8c_source.html)。`memory` 每 250 ms 用 ps 采样 Node 及其所有后代的 RSS，分别统计 Chrome、FFmpeg 和同一时刻整个进程树峰值。分项峰值不能相加；RSS 共享页可能重复计数，采样可能漏掉瞬时峰值。无 ps 时报告缺失，不能按零内存视为通过。

固定本机回归预算为 720p 平均合成不超过 110 ms/帧、准备不超过 30 s、进程树峰值不超过 2.5 GiB。重复长教程检查第二次长教程峰值增长不超过 512 MiB。预算是回归指标，不是服务器容量承诺；4K、高并发及资源受限服务器需在目标环境验证。

## 画面与生命周期验证

单元测试检查 PNG/RGBA 字节 LRU、原生 alpha 合成、透明度、裁剪、亚像素、旋转及独立帧读回。集成测试比较两种后端的真实解码 RGB，检查合成后端串行/双帧批次输出一致，覆盖半开时间采样及固定浏览器关键帧。

另一项图层集成测试在深色主题、曲线光标和按下缩小模式下乱序取样，覆盖输入框、IME、字段菜单、右键菜单、高亮、标注、拖拽、target 切换和三 target UI；重复同一状态必须不新增截图或 SVG 栅格。舞台测试验证实际绿色/蓝色裁剪帧、间隙、CORS 跨域像素读取及单视频轨。平均通道误差预算为 3/255，通道差超过 32 的像素比例不超过 2.5%。

取消/故障测试覆盖准备中、帧写入后、缺失编码器、提前失败和编码器不读取 stdin，检查已有输出保留、临时文件移除、阻塞进程结束。

关键帧图片位于 `tests/fixtures/export/`，由 `tests/integration/export.test.mjs` 对照实际浏览器输出。基准报告与视频写入忽略的 `artifacts/`，包含环境、字体和源码摘要；字体或浏览器版本变化时需重新评估画面误差。
