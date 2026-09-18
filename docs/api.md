# 教程 API

`defineTutorial` 的 `SceneBuilder` 提供两层 API。所有操作均可序列化为 JSON，时长单位为秒。

- `scene.direct.*` 立即修改场景，不移动鼠标、不产生轨道、不增加时间；不接收 duration/easing。用于预置状态或省略演示过程，之后可显式 `wait`。
- 根级的 `move`、`connect`、`split`、`delete`、`type`、`choose`、`contextMenu` 等表现编辑器交互。操作的 duration 控制主体动作，鼠标接近、点击等时间另计。

底层方法：`direct.create(blocks, to)`、`direct.move(id, to)`、`direct.connect(id, connection)`、`direct.delete(id)`、`direct.setField(field, value)`、`direct.selectTarget(id)`、`direct.selectCategory(category)`、`direct.reveal(entry)`。JSON 对应原操作附加 `mode: "direct"`。

保留 `create(blocks, {to, duration?})` 与 `setField(field, value, timing?)` 两个明确的程序化便捷入口，以及 `paste` 的原子插入语义；它们不假装产生拖动或键入过程。新教程预置状态优先使用 direct 分组。

## 删除与右键菜单

```ts
scene.delete('block'); // 接近、抓起整段、拖到 toolbox，松开后删除
scene.delete('block', { duration: 0.6 });
scene.delete('block', { via: 'contextMenu' }); // 右键打开菜单、点击删除，原地原子移除
scene.contextMenu('block', 0.8); // 右键展示真实菜单，停留后点击工作区关闭
scene.direct.delete('block'); // 立即移除整段，无动画
```

右键菜单来自固定 Blockly 的真实 `showContextMenu_` 选项，保留文本、顺序与禁用态。目前高层支持展示/关闭与删除，其余菜单项目可见但不提供对应作者动作。不是观众可操作的编辑器。

删除方式会改变结构语义：工具箱删除与 direct.delete 删除整棵拖动子树（含 next）；右键删除委托 `dispose(true, false)`，删除选定块及嵌套内容，保留 next，并按 Blockly 的实际规则尝试补接。不会再播放原来的淡出动画。shadow 本身不可删除/拖动；删除覆盖输入的 reporter 时恢复原 shadow。

`move` 和 `connect` 现在可以直接引用已连接的子块，会像编辑器一样先拖开子树；`split` 保留为强调拆分过程的显式入口。被占用的连接仍拒绝，不自动挤出已有积木。

迁移：`delete(id, 0.4)` 改为 `delete(id, {duration: 0.4})`。依赖原淡出删除或即时 target 切换的教程应明确选择底层操作，或重新检查高层交互增加的时间。

## 连接与 target 切换

高层连接接近目标时，语句积木展示原生 insertion marker，reporter/boolean 对已有 shadow 或空输入槽展示 replacement glow。拆开后尚未离开原连接范围时也保留预览；所有拖动积木使用原生拖动表面的投影参数。底层 connect 直接拼接，不展示预览。

高层 selectTarget 自动滚动角色列表、移动鼠标并点击目标，松手后才切换工作区和工具箱；选择当前 target 不产生动作。direct.selectTarget 立即切换。浏览器播放、跳转和视频导出共享相同的布局和轨道。

## 完整示例

[examples/all-api/tutorial.ts](../examples/all-api/tutorial.ts) 覆盖全部 SceneBuilder 操作、8 个 direct 方法，以及 ref、workspace.slot、defineBlocks 辅助方法。示例使用独立 ID，展示两种删除的结构差异，并包含自动中文输入、并行标注、原生菜单和 target 点击。

```sh
pnpm example:all-api
pnpm preview
# 打开 /apps/playground/index.html?scene=/artifacts/all-api/tutorial.json
```

编译、检查、目录查询和视频导出：

```sh
pnpm motion compile examples/all-api/tutorial.ts artifacts/all-api/tutorial.json
pnpm motion check artifacts/all-api/tutorial.json
pnpm motion catalog examples/all-api/tutorial.ts artifacts/all-api/catalog.json
pnpm motion export artifacts/all-api/tutorial.json artifacts/all-api/tutorial.mp4 30 --font /absolute/path/font.ttf
```

`compile` 发布版本 2 的 `TutorialBundle`；积木布局和合法性完整校验由 `check` 或浏览器准备阶段执行。`catalog` 返回真实目录键、积木定义与能力描述，不包含 SVG 素材。Node 也可从 `@blockdia-motion/authoring/bundle` 调用 `bundleTutorial(spec)`。

浏览器使用 `runtime:build` 生成的模块入口，不需要额外 import map：

```ts
import { mountPlayer } from '/runtime/turbowarp-7c58de66-a2946eeb-client-1/modules/renderer-browser/index.js';
const url = new URL('/tutorials/example/tutorial.json', location.href);
const bundle = await (await fetch(url)).json();
const player = mountPlayer(document.querySelector('#player'), bundle, {
  runtimeUrl: '/runtime/turbowarp-7c58de66-a2946eeb-client-1/',
  resourceBaseUrl: url.href,
  // 默认采用浏览器上的 Helvetica Neue / Helvetica / Arial / sans-serif。
  // font: { family: 'Tutorial Font', url: '/fonts/tutorial.woff2' },
  cursorMotion: 'curve',
  cursorClickEffect: 'shrink',
  async loadVariant({ locale }, signal) {
    const response = await fetch(`/tutorials/example/tutorial.${locale}.json`, { signal });
    if (!response.ok) throw Error('Language variant unavailable');
    return response.json();
  },
});
await player.ready;
await player.seek(2.5); // 等待 DOM 与舞台视频帧就绪
player.play();
player.pause();
await player.setOptions({ locale: 'zh-CN', theme: 'dark' });
player.setCursorMotion('linear');
player.setCursorClickEffect('circle');
console.log(player.time, player.duration, player.playing, player.view);
player.resetView();
player.dispose();
```

语言变化需要对应语义教程的加载器；主题和字体变化复用当前语义教程，在临时 iframe 中重新准备。切换暂停并保留时间，准备成功后替换；失败保留旧画面，Promise 拒绝。先等待 `ready` 再操作播放器。销毁释放监听器、视频、字体和准备环境。

`resourceBaseUrl` 是教程文件 URL 或以 `/` 结尾的资源目录 URL；语言变体的相对媒体路径仍使用这个资源基址。运行时必须同源，视频和自定义字体跨域时由资源服务提供相应 CORS 响应。视频服务应支持字节 Range 请求，以便精确跳转。

`cursorClickEffect` 可选 `circle`（默认）或 `shrink`；`cursorMotion` 可选 `linear`（默认）或 `curve`。曲线由时间确定，拖拽保持抓取偏移，不依赖帧率积分。继续播放和跳转恢复教程视角。

舞台视频声明在教程根节点，片段按开始时间排序，不重叠：

```ts
stage: {
  clips: [
    { src: './stage.mp4', start: 1, in: 0.5, duration: 3 },
    { src: './ending.mp4', start: 5, in: 0, duration: 2 },
  ],
}
```

`start` 是教程秒数，`in` 是媒体起点，`duration` 是播放时长；区间为 `[start, start + duration)`，片段外显示舞台底色。视频固定一倍速、静音、等比例容纳；教程总时长覆盖最后一个片段。不存在的媒体、越界和解码失败会报错，缓冲时暂停教程时钟。CLI 编译会将相对媒体路径重定位到输出文件；发布时应一同复制媒体。

Node 的 `exportVideo(bundle, { output, font, fps, resourceBaseUrl })` 来自 `@blockdia-motion/renderer-video`，其中 `font` 是必填的本地字体路径。默认使用 UI 图层截图缓存、SVG 栅格素材缓存与逐帧 RGBA 合成，再由 FFmpeg 编码；`resourceBaseUrl` 相对本地静态服务根目录解析。首轮不输出音轨。

`CompiledScene`、`compile(spec, adapter)` 和素材 manifest 是准备器内部协议，用于语义与布局测试，不是发布格式。原整场 `frameSvg` 和 `rasterFrame` API 已移除。

## 导出选项与取消

```ts
const controller = new AbortController();
await exportVideo(bundle, {
  output: '/absolute/path/tutorial.mp4',
  font: '/absolute/path/font.ttf',
  fps: 30,
  backend: 'composite', // 'screenshot' 可用于画面参考和性能对比
  width: 1920,
  height: 1080,
  concurrency: 1,
  cacheBytes: 32 * 1024 * 1024,
  encoderThreads: 2,
  signal: controller.signal,
  onProgress: ({ phase, completed, frames }) => console.log(phase, completed, frames),
});
// 可在导出进行时从另一事件调用 controller.abort()。
```

默认 `backend: 'composite'`，输出 1280×720/30 fps。尺寸必须是偶数、16:9，最多 3840×2160；逻辑画布仍为 1280×720，整体缩放。帧率为整数 1–120，并发为整数 1–4，缓存为 0–256 MiB，编码线程为整数 1–16。

合成后端按 UI 状态缓存 Chrome 的透明局部截图，使用指定字体栅格化 SVG，再通过 `@napi-rs/canvas` 的 Skia Canvas 2D 按时间快照合成 RGBA 帧。32 MiB 默认预算约束动态图层 LRU；固定背景、飞出栏底色、控件和光标另计为 `fixedLayerBytes`，可复用帧表面池、独立 RGBA 帧队列和原生分配器开销另计。`cacheBytes: 0` 关闭动态图层缓存，固定图层仍保留。舞台视频逐帧解码，UI/SVG 缓存继续使用。有限并发合成复用一个浏览器页面，UI 捕获和舞台解码串行化；原生绘制调用并不因此成为多线程。

`backend: 'screenshot'` 保留整场 Chrome 截图参考后端，每个并发页面独立准备。其缓存保存 PNG 整帧，有舞台视频时关闭。两种后端都按帧序流式编码，最多一个并发批次等待写入；PNG 帧与 RGBA 帧的字节量不同。

`onProgress` 的阶段为 `prepared`、`frames`、`encoding`；回调抛错会终止导出并清理。取消或失败会关闭 Chrome、等待编码器结束、移除临时 MP4；成功后原子替换输出。API 调用者须先创建输出父目录。报告包含准备、合成、管道背压、编码 CPU/收尾、缓存和队列峰值以及进程树 RSS；字段口径与环境预算见 [P4](p4.md)。

CLI 保留位置参数帧率，并支持：

```sh
pnpm motion export artifacts/all-api/tutorial.json artifacts/all-api/tutorial.mp4 30 \
  --font /absolute/path/font.ttf --size 1920x1080 \
  --concurrency 1 --cache-mib 32 --encoder-threads 2 --backend composite
```

Ctrl+C / SIGTERM 取消导出并清理临时资源。播放器的 `preparationStats` 提供当前已成功准备场景的素材数量、SVG 内容 UTF-8 字节数和素材准备耗时；返回副本，卸载后为 `undefined`。

`player.getPreparedScene()` 在准备成功后提供当前 `CompiledScene` 的深拷贝，供同源导出桥接使用；准备中或卸载后抛错。该对象是内部布局协议，不应用作发布教程格式。
