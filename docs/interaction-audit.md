# Blockly 交互状态核查

对照当前固定的 `.cache/turbowarp/core` 源码，核查范围为已支持的拖动、连接、拆分、删除、字段下拉菜单及工具箱分类滚动。以下状态均由浏览器与视频共用的场景轨道求值，不依赖播放历史。

| 状态                        | 原生依据                                                                                                        | 实现与验证                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 语句连接预览                | `insertion_marker_manager.js`：`showPreview_` / `connectMarker_`                                                | 提取真实 insertion marker；松手后原子替换完整根资源                                                           |
| reporter / boolean 输入预览 | 同文件：`highlightBlock_`；`block_render_svg_vertical.js`：`highlightForReplacement` / `highlightShapeForInput` | 保留原 shadow，或高亮空输入轮廓；提取原生 replacement filter，资源和渲染实例分别重命名引用                    |
| 拆出时的原连接预览          | `constants.js` 的 48 / 68 半径；`getStartRadius_`                                                               | 根据拖动曲线与距离计算出现/消失时间，不使用固定时间比例                                                       |
| 拖动投影                    | `block_drag_surface.js`：`createDropShadowDom_`                                                                 | SourceAlpha 模糊 6、透明度 .3、140% 范围；只作用于拖动资源，松手消失                                          |
| 下拉框打开态                | `field_dropdown.js`：`showEditor_` / `onHide`                                                                   | 调用原生打开方法提取字段背景，不以矩形覆盖；关闭后恢复普通资源，兼容圆形 shadow 菜单                          |
| 菜单行 hover                | `css.js`：`.blocklyDropDownDiv .goog-menuitem-highlight`；`colours.js`：`menuHover`                             | 鼠标每帧命中行；黑色 .2 叠加，与 checked 对勾独立，禁用行不高亮                                               |
| 分类滚动                    | `flyout_base.js`：`stepScrollAnimation`                                                                         | 点击分类后滚动；剩余距离为初始距离 × `.3 ** (elapsedMs / 60 + 1)`，不足 1 像素到位；长距离不被默认 .25 秒截断 |

回归：`tests/integration/interaction-states.test.mjs` 验证 boolean 空槽、菜单打开/关闭资源、点击前 hover 和滚动公式；`structural-editing.test.mjs` 覆盖 reporter shadow、容器拆分及所有预览中间帧的浏览器/视频像素对比；`all-api.test.mjs` 检查实际 playground 页面。测试截图写入 `artifacts/browser-tests/`，全部 API 示例写入 `artifacts/all-api/`。
