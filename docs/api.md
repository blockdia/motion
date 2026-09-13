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

高层连接在接近目标时展示原生 Blockly 插入阴影，松手时原子替换为连接后的积木。底层 connect 直接拼接，不展示阴影。

高层 selectTarget 自动滚动角色列表、移动鼠标并点击目标，松手后才切换工作区和工具箱；选择当前 target 不产生动作。direct.selectTarget 立即切换。浏览器播放、跳转和视频导出共享相同的布局和轨道。
