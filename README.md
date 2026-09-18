# Blockdia Motion

用 TypeScript/JSON 编排 TurboWarp 风格的编辑教程，支持客户端播放和离线视频导出。

当前链路是：**语义教程资源 → 浏览器布局与 Blockly 素材准备 → 销毁临时准备环境 → HTML/SVG 时间线播放**。编辑器壳复用固定版本 TurboWarp 的真实 DOM/CSS，舞台播放静音视频，不执行 Scratch 项目。

```sh
pnpm install --frozen-lockfile
pnpm bootstrap:blocks
pnpm bootstrap:gui
pnpm bootstrap:catalog
pnpm build
pnpm preview
```

打开 [本地 playground](http://127.0.0.1:4173/)。`build` 构建运行时和全部五个示例，默认展示中英文、浅深主题和舞台视频。首次构建运行时会启动无头 Chrome，从固定 GUI 提取外壳；后续复用模板。修改外壳提取器后会自动重建，也可执行 `pnpm shell:build`。

开发环境需要 Node.js ≥22.18、Chrome、FFmpeg，以及固定版本 Blockly/GUI 的源码和构建依赖，详见 [开发与构建](docs/development.md)。这些源码 checkout 只用于构建，正式播放不访问它们。

```sh
pnpm motion compile examples/all-api/tutorial.ts artifacts/all-api/tutorial.json
pnpm motion check artifacts/all-api/tutorial.json
pnpm motion catalog examples/all-api/tutorial.ts artifacts/all-api/catalog.json
pnpm motion export artifacts/all-api/tutorial.json artifacts/all-api/tutorial.mp4 30 --font /absolute/path/font.ttf
pnpm test
pnpm test:integration
pnpm format:check
```

`compile` 不启动浏览器，也不测量字体。发布的 `tutorial.json` 不包含积木 SVG；`check` 和客户端准备执行完整的积木与连接校验。`?scene=/path/tutorial.json` 可加载自定义语义资源。

静态部署时复制生成的版本化运行时目录、教程 JSON 和媒体文件，参照 [播放器 API](docs/api.md) 设置 `runtimeUrl` 与 `resourceBaseUrl`。网页默认使用 TurboWarp 风格的系统字体栈，允许指定字体；视频导出必须提供字体文件。

- [教程 API 与播放器](docs/api.md)
- [客户端渲染、外壳来源与限制](docs/client-rendering.md)
- [开发与构建](docs/development.md)
- [导出性能、预算与长视频基准](docs/video-export.md)
- [Blockly 交互状态核查](docs/interaction-audit.md)
- [全部 API 示例](examples/all-api/tutorial.ts)
- [第三方来源与许可](THIRD_PARTY_NOTICES.md)
