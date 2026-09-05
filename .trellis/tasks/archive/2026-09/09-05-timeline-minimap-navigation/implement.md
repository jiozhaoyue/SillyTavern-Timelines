# 实施计划: 时间树全景小地图与鸟瞰拖拽导航 (Implementation Plan)

## 实施步骤清单

### Phase 1: 纯数学坐标转换算法与单元测试 (`src/minimap-math.js` & `tests/minimap.test.mjs`)

- [x] 实现 `calculateProjection(graphBounds, canvasWidth, canvasHeight, padding)` 纯函数与 `calculateCenterPan`。
- [x] 实现 `modelToCanvas(point, transform)` 与 `canvasToModel(point, transform)` 双向转换。
- [x] 实现 `extentToCanvasRect(extent, transform)` 投影取景框计算。
- [x] 编写自动化单元测试覆盖所有极限与边界情况（全图点、边界点、不同高宽比、视口放大/缩小）。

### Phase 2: 小地图 Canvas 渲染与拖拽交互组件 (`src/minimap.js` & `style.css`)

- [x] 创建 `Minimap` 类：动态构建 `#timelinesMinimapDrawer` 顶部抽屉容器与 `<canvas>` 节点。
- [x] 实现底层拓扑粒子全景快照渲染与顶层视口框双缓冲绘制。
- [x] 实现 `pan` / `zoom` 监听与 `requestAnimationFrame` 防抖同步。
- [x] 实现鼠标/触屏交互（单击直接居中、按住取景框平移拖拽、折叠展开按钮）。
- [x] 编写符合酒馆主题的美化样式（毛玻璃微透底底、发光线框、高对比度指示器）。

### Phase 3: 主入口挂载与实机自动化验证 (`index.js` & CDP 端到端测试)

- [x] 在 `renderCytoscapeDiagram` 中实例化并挂载 `Minimap`，并在顶栏添加地图切换按钮。
- [x] 确保模态框关闭/销毁时自动销毁 Minimap 与事件监听器，避免内存泄漏。
- [x] 运行测试套件与 CDP 实机验证小地图渲染与拖拽，并截屏归档 (`luker_timelines_minimap.png`)。

