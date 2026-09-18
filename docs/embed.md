# 独立播放器与 iframe 嵌入

运行 `pnpm build && pnpm preview` 后，可直接打开：

```text
http://127.0.0.1:4173/player/?scene=/artifacts/playground/tutorial.zh-CN.json
```

Playground 通过 iframe 嵌入同一独立播放器，保留示例选择、重新加载和语言切换；“独立播放器”链接打开当前教程与主题设置。独立页面仅展示教程画面和播放控件，复用 `mountPlayer()`，支持工作区平移、缩放和静音舞台视频。

播放条叠在画面底部，提供播放/暂停、拖动进度、当前时间、设置和全屏。播放时闲置约两秒后收起，移动鼠标或聚焦控件可显示。设置弹窗提供播放速度、主题、鼠标运动和点按效果；主题默认跟随系统，可固定为浅色或深色。系统主题变化会自动更新跟随系统的播放器；主题更新会暂停并保留播放位置。聚焦画面后可用空格或 K 播放/暂停，Escape 关闭设置。

## URL 参数

| 参数       | 说明                                                                | 默认值     |
| ---------- | ------------------------------------------------------------------- | ---------- |
| `scene`    | 必填，教程 JSON 的 HTTP(S) 地址；相对地址以播放器页面为基准         | 无         |
| `theme`    | `system` 跟随系统，或固定为 `light`、`dark`                         | `system`   |
| `locale`   | `zh-CN` 或 `en`，指定读取教程前的加载提示语言；读取后以教程声明为准 | 浏览器语言 |
| `controls` | `1` 显示播放、进度和时间控件，`0` 隐藏                              | `1`        |
| `autoplay` | `1` 在准备完成后播放，`0` 等待操作                                  | `0`        |

构造 URL 时使用 `URL` 和 `URLSearchParams`，避免教程地址中的 `&`、`#` 等字符影响参数解析。教程使用自己声明的语言；如需其他语言，指定对应语言的教程 JSON。

## iframe 示例

```html
<iframe
  src="https://motion.example.com/player/?scene=%2Ftutorials%2Fediting%2Ftutorial.json"
  title="代码编辑教程"
  style="display:block;width:100%;height:480px;border:0"
  loading="lazy"
  allowfullscreen
></iframe>
```

画面保持 1280×720 的逻辑比例，按 iframe 的可用宽高适配，剩余空间居中留白。播放条叠在画面内，不额外占用高度。可以给 iframe 设置 `aspect-ratio:16/9` 和 `height:auto`；隐藏控件时设置 `controls=0&autoplay=1`。全屏按钮需要宿主 iframe 的 `allowfullscreen` 授权，未获授权时不显示。

第一版通过 URL 配置，不提供跨域父页面的 `postMessage` 控制协议。宿主页面无需加载 Motion、Blockly 或 TurboWarp 依赖。

## 静态部署

`pnpm runtime:build` 在版本化运行时目录内生成 `embed.html`，它使用同目录运行时资源，可整体搬迁：

```text
published/
  runtime/
    embed.html
    modules/
    prepare.html
    ...其余运行时文件
  tutorials/
    editing/
      tutorial.json
      stage.mp4
```

此目录结构对应入口：

```text
/published/runtime/embed.html?scene=../tutorials/editing/tutorial.json
```

教程媒体地址相对于实际下载到的教程 JSON 地址解析，也支持 JSON 的 HTTP 重定向。教程 JSON 和媒体可以放在其他域名，资源服务需允许播放器域名的跨域读取。部署服务应允许目标网站嵌入该播放器页面；若设置 `Content-Security-Policy: frame-ancestors` 或 `X-Frame-Options`，需确保策略允许目标网站。

运行时中的 `player.html` 继续用于 API 挂载、视频导出和测试；公开嵌入入口使用 `embed.html`。
