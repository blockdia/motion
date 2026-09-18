# 开发与构建

## 环境与固定来源

需要 Node.js ≥22.18、pnpm 10.17.1、Python 3、Java、Chrome 和 FFmpeg（含 ffprobe）。Chrome 默认使用 macOS 的 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，其他安装位置通过 `CHROME_PATH` 指定。网页可使用系统字体；视频导出必须通过 `--font` 指定覆盖教程语言的字体文件。

- Scratch Blocks：`7c58de666658df1bb447d010132aa3914c10f41e`，默认读取相邻 `../scratch-blocks`，可用 `TURBOWARP_BLOCKS` 覆盖。该 checkout 需已安装构建依赖。
- Scratch GUI：`a2946eeb9a9dca7857d7ab53d766b54288c7a2ff`，默认读取相邻 `../scratch-gui`，可用 `TURBOWARP_GUI` 覆盖。
- Scratch VM：由固定 GUI 的 lockfile 锁定，素材准备仅使用 target、变量、Blocks 和 XML 数据模型。

构建脚本通过 `git archive` 将固定版本解入 `.cache/`，不会修改提供的源码 checkout。Blockly 构建复用源码 checkout 的 `node_modules`；GUI 快照使用自己的 lockfile 安装依赖并构建。外壳提取与目录桥接共用这一固定 GUI 快照。

```sh
pnpm install --frozen-lockfile
pnpm bootstrap:blocks
pnpm bootstrap:gui
pnpm bootstrap:catalog
pnpm build
pnpm preview
```

`bootstrap:blocks` 调用上游 `build.py`，记录生成入口的 SHA-256。`bootstrap:gui` 构建固定 GUI 并记录 lockfile 摘要。`bootstrap:catalog` 打包 GUI toolbox 与 VM 数据模型桥接，对照固定 commit 检查实际引用的 GUI 源文件，保存输入文件及 bundle 摘要。

`build:packages` 只构建 TypeScript 包，不启动浏览器。`build` 调用 `runtime:build` 并生成全部示例；`runtime:build` 先构建 TypeScript 包，再校验 Blockly/目录构建记录，将浏览器模块、媒体图标、外壳模板和许可复制到 `artifacts/runtime/<adapterVersion>/`。外壳提取器变化时自动重新提取中英文、浅深主题四份模板。修改目录桥接或准备环境前，应先重建对应输入，再执行 `runtime:build`。

## GitHub Pages

```sh
pnpm build:playground
pnpm test:playground
python3 -m http.server 4174 --directory dist/playground
```

`build:playground` 执行完整 `build` 后整理 `dist/playground/`，包括首页、`player/index.html`、版本化 runtime、全部示例 JSON、舞台视频和 `.nojekyll`。每次构建清理此发布目录，不包含源码 checkout、构建缓存、测试输出或离线视频导出依赖。相对资源路径自动适配域名根目录和 GitHub Pages 仓库子路径，无需设置 base URL。`test:playground` 使用仅能读取发布目录的普通静态服务器，在 `/` 和 `/motion/` 下验证全部示例、语言切换、视频、独立播放器及刷新。

`.github/workflows/deploy-playground.yml` 在推送 `main` 或手动触发时运行，使用 Node 22 系列最新补丁版本、项目固定 pnpm 版本及 Ubuntu 的 Chrome、Python、Java、FFmpeg。它独立 checkout 上述两个 TurboWarp 固定 commit，安装各自 lockfile 的依赖，通过现有 bootstrap 脚本构建运行时，然后构建、验证并上传静态发布目录。无需准备相邻本地仓库。

在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**，随后推送或手动运行 workflow。部署使用 `github-pages` environment 和 GitHub 自动提供的 token，无需额外部署密钥。自定义教程 `scene` 参数仍按普通 URL 解析；在仓库子路径部署时，自定义绝对路径需包含仓库前缀，或使用完整 URL。

## 示例与目录发现

作者示例在 `examples/` 中以 TypeScript 维护；JSON 输入等价测试使用 `tests/fixtures/basic-editing.json`。构建生成的播放器资源写入 `artifacts/`。

`build` 生成 playground 的全部示例和测试舞台视频。也可分别生成：

| 命令                      | 输出                                         |
| ------------------------- | -------------------------------------------- |
| `pnpm example:basic`      | `artifacts/basic-editing/tutorial.json`      |
| `pnpm example:structural` | `artifacts/structural-editing/tutorial.json` |
| `pnpm example:all-api`    | `artifacts/all-api/tutorial.json`            |
| `pnpm example:targets`    | `artifacts/targets/tutorial.json`            |

单独的语义编译命令可先执行 `build:packages`；播放、目录查询和完整校验还需要构建运行时。多 target 示例通过实际目录选择条目，因此生成时也使用浏览器准备器。

使用 `motion catalog <tutorial.json|tutorial.ts> <catalog.json>` 获取各 target 的真实完整目录。`dragFromToolbox` 使用生成的完整 `entry.key`；字段引用使用实际块 ID 和字段名，例如移动积木数值 shadow 的 `move.STEPS.shadow` / `NUM`。不维护 opcode 白名单，连接合法性委托固定 Blockly。

## 验证

```sh
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:catalog-reference
pnpm format:check
git diff --check
```

单元测试覆盖教程协议、语义编译、确定性求值、输入法和导出预算；集成测试构建运行时及舞台视频，覆盖真实 Blockly、结构编辑、完整 toolbox、播放器交互与外观变体、静态部署及 FFmpeg 导出。导出测试默认使用本机 Arial Unicode 字体。

`test:catalog-reference` 将准备桥生成的目录与独立启动的完整固定 GUI 对照，验证多 target 的条目、定义与菜单；报告和截图写入 `artifacts/catalog-reference/`。测试生成文件均在忽略的 `artifacts/` 中。导出回归关键帧保存在 `tests/fixtures/export/`；性能口径与复测命令见 [导出基准](video-export.md)。

## 支持边界

支持普通积木、文本/数值字段、文本下拉菜单、shadow fallback、语句与 reporter/boolean 连接、容器拆分、删除、粘贴、模拟中文输入、高亮与标注。准备阶段按完整结构收集和复用实际素材，连接完成时原子替换根资源；播放不保留 Blockly 工作区。

目前不支持拖出 mutation 目录条目、交互式 mutation 修改、图片选项菜单、颜色选择器动画、任意 UI 菜单动作、失败连接回弹或已占用槽的自动挤出。右键菜单支持展示/关闭与删除；其他项目可见但没有对应作者动作。未知操作和不支持能力在校验或准备阶段明确报错。
