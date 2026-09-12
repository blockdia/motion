# Blockdia Motion

用代码编排 TurboWarp / Blockdia 风格的代码编辑教程，支持浏览器播放与离线视频渲染。

已完成 **P1b 通用教程闭环**：TypeScript/JSON 作者入口、语义编译、真实 Blockly 校验与 SVG 提取、可跳转播放器，以及同一编译产物的 CLI 视频导出。编辑器画面复用 P1a 的固定 TurboWarp 布局基线；P0 固定示例仍保留。

```sh
pnpm install --frozen-lockfile
pnpm p0:bootstrap
pnpm test
pnpm test:integration
pnpm p1b
pnpm preview
```

需要 Node.js ≥22.18、已安装构建依赖的相邻 `scratch-blocks` checkout、Chrome、FFmpeg、Python 3 和 Java。其他路径/系统配置见 [P0 复现说明](docs/p0.md)。

预览位于 [本地播放器](http://127.0.0.1:4173/apps/playground/index.html)，编译产物、视频和关键帧位于 `artifacts/p1b/`。

```sh
pnpm build
pnpm motion check examples/basic-editing/tutorial.json
pnpm motion compile examples/basic-editing/tutorial.ts artifacts/p1b/scene.json
pnpm motion export artifacts/p1b/scene.json artifacts/p1b/tutorial.mp4 30
```

- [TypeScript 示例](examples/basic-editing/tutorial.ts) / [等价 JSON](examples/basic-editing/tutorial.json)
- [P1b 作者接口、支持矩阵与验收](docs/p1b.md)
- [架构与实施计划](docs/plan.md)
- [P1a 参考画面、布局与允许差异](docs/p1a.md)
- [P0 素材路线与性能基线](docs/p0.md)
- [第三方素材来源](THIRD_PARTY_NOTICES.md)
