# 技术方案设计: 时间树全景小地图与鸟瞰拖拽导航 (Design Document)

## 1. 架构模块设计

```text
src/
├── minimap.js           # 小地图核心逻辑 (Canvas 渲染、坐标转换、拖拽平移事件调度)
├── minimap-math.js      # 纯数学投影计算函数 (便于独立单元测试)
└── index.js             # 在 initializeCytoscape / renderCytoscapeDiagram 中挂载 Minimap 实例
```

---

## 2. 坐标转换与投影算法 (`src/minimap-math.js`)

设全图元素的边界盒（包含 padding）：

- 图外接包围盒：$BB = [x_{min}, y_{min}, x_{max}, y_{max}]$
- 图宽度 $W_g = x_{max} - x_{min}$，图高度 $H_g = y_{max} - y_{min}$
- 小地图 Canvas 尺寸：$W_c, H_c$
- 等比缩放比例因子：
  $$S = \min\left(\frac{W_c}{W_g}, \frac{H_c}{H_g}\right)$$
- 居中偏移量：
  $$O_x = \frac{W_c - W_g \cdot S}{2} - x_{min} \cdot S$$
  $$O_y = \frac{H_c - H_g \cdot S}{2} - y_{min} \cdot S$$

### 坐标映射函数

1. **模型坐标到小地图坐标** $(x_m, y_m) \to (x_c, y_c)$：
   $$x_c = x_m \cdot S + O_x$$
   $$y_c = y_m \cdot S + O_y$$
2. **小地图坐标到模型坐标** $(x_c, y_c) \to (x_m, y_m)$：
   $$x_m = \frac{x_c - O_x}{S}$$
   $$y_m = \frac{y_c - O_y}{S}$$
3. **主图当前视口取景框**：
   从 Cytoscape 获取 `cy.extent()` 得到主图当前可见区域：
   $$Extent = \{ x_1, y_1, x_2, y_2 \}$$
   将该四角坐标通过投影映射为 Canvas 上的高亮矩形：
   $$Rect_{vp} = [ x_{c1}, y_{c1}, x_{c2} - x_{c1}, y_{c2} - y_{c1} ]$$

---

## 3. 事件交互与拖拽设计

- **双层绘制设计**：
  - 底层：拓扑全景图缓存（只有在节点数据或拓扑结构改变时重绘一次）。
  - 顶层：取景框绘制（随着 `cy.on('pan zoom')` 每帧更新，仅重绘取景矩形，耗时仅几十微秒）。
- **拖拽状态机**：
  - `PointerDown` / `TouchStart`：
    - 若命中取景框内部：进入 `DRAGGING_VIEWPORT` 状态，记录相对于取景框中心的偏移。
    - 若在取景框外部：计算点击位置对应的逻辑模型坐标，执行 `cy.center({ x: targetX, y: targetY })`。
  - `PointerMove` / `TouchMove`：
    - 在 `DRAGGING_VIEWPORT` 状态下，逆向转换增量偏移为模型位移 $\Delta X_m, \Delta Y_m$，实时更新主图 `cy.panBy(...)` 或直接设置 `cy.center(...)`。
  - `PointerUp` / `TouchEnd`：退出拖拽状态。
