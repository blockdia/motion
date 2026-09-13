# 素材来源

- Scratch / TurboWarp Scratch Blocks，MIT 与各贡献者，固定版本 7c58de666658df1bb447d010132aa3914c10f41e，来源 https://github.com/TurboWarp/scratch-blocks 。仓库 LICENSE 为 GPL-3.0，部分源码文件包含 Apache-2.0 头；原始文件的许可声明保留在准备快照中。生成的积木路径、文字布局与绿旗图标来自该源码。
- TurboWarp GUI，Scratch Foundation、MIT 与各贡献者，固定版本 a2946eeb9a9dca7857d7ab53d766b54288c7a2ff，来源 https://github.com/TurboWarp/scratch-gui 。P1a 外壳参考其实际构建截图、区域结构和样式；adapters/turbowarp/icons.mjs 包含该版本的菜单、标签、舞台、角色与扩展控件 SVG，docs/p1a-baseline/reference.png 是其本地运行截图；原项目 LICENSE 为 GPL-3.0。许可证文本位于 licenses/TurboWarp-GPL-3.0.txt。
- TurboWarp VM，Scratch Foundation、MIT 与各贡献者，固定为 GUI lockfile 中的 c4823421cb7c17d8d8a89878851ce1668c26a21f。P1c 准备阶段复用其 target、变量及 Blocks 数据模型和 XML adapter；不在播放器中运行。来源 [TurboWarp/scratch-vm](https://github.com/TurboWarp/scratch-vm)，上游许可为 MPL-2.0，原始许可保留在 `.cache/gui/node_modules/scratch-vm/`。GUI 的 toolbox 构建函数与动态菜单绑定同样仅用于素材准备。
- Arial Unicode 字体使用本机已有文件，仅用于本地验证，不在仓库内分发。复现报告保存实际字体哈希；其他环境需提供具有相应使用权限且覆盖中文的字体。
- resvg-js 与 Playwright 的版本固定在 pnpm-lock.yaml，依赖包保留各自许可证。FFmpeg 为外部运行工具，报告记录实际版本。

- @kensio/pinyinjs 1.7.13，来源 [KensioSoftware/pinyinjs](https://github.com/KensioSoftware/pinyinjs)。代码为 Apache-2.0；随包词典包含 CC-CEDICT（CC BY-SA 4.0）、Unihan、jieba 等来源，具体条款见依赖包的 LICENSE 与 NOTICE。用于教程编译的分词、汉字转拼音及拼音候选反查，版本与完整性记录在 pnpm-lock.yaml。

此文件记录素材来源，不变更各上游原有的许可与商标声明。
