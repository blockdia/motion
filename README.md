# Blockdia Motion

用代码编排 TurboWarp / Blockdia 风格的代码编辑教程，支持浏览器播放与离线视频渲染。

已完成 **P0 固定示例验证**：从工具箱拖出事件帽和移动积木、连接、将参数 10 改为 20；包含真实 Blockly SVG 提取、中文与嵌套样例、独立主题样式、无 Blockly 的播放器，以及 resvg + FFmpeg 视频导出。

```sh
pnpm install --frozen-lockfile
pnpm p0:bootstrap
pnpm test
pnpm p0
pnpm preview
```

需要构建依赖已安装的相邻 `scratch-blocks` checkout、Chrome、FFmpeg、Python 3 和 Java。其他路径/系统配置见 [P0 复现与验证](docs/p0.md)。预览默认位于 http://127.0.0.1:4173，视频和关键帧生成于 `artifacts/`。

- [架构与实施计划](docs/plan.md)
- [P0 复现、来源、边界与性能基线](docs/p0.md)
- [第三方素材来源](THIRD_PARTY_NOTICES.md)

通用 TypeScript/JSON 作者 API 和编译器属于后续 P1。
