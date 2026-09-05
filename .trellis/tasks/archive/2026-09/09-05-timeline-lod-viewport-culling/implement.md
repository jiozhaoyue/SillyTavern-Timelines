# Implementation Plan: 超大时间树 LOD 分层抽稀与动态视口性能优化

## 阶段划分 (Execution Steps)

### Step 1: 编写核心抽稀折叠拓扑算法与单元测试
- 新建 `src/lod-service.js`：
  - 实现 `findCollapsibleChains(elements, options)`。
  - 实现 `applyLodToElements(elements, expandedClusterIds, options)`。
  - 实现 `expandClusterInElements(elements, clusterId)`。
  - 严密处理各种边界：保护节点（记忆、书签、根节点、分支点、叶子节点）、超短链、分支循环。
- 新建 `tests/lod.test.mjs`：
  - 编写 6~8 项独立单元测试，验证链检测、替换、展开、保护机制与极端空图。
  - 运行 `node --test tests/*.test.mjs` 确保全部通过。

### Step 2: 样式与 Cytoscape 视觉分级适配
- 修改 `src/style.js` 与 `style.css`：
  - 添加 `node[?isCollapsedCluster]` 胶囊样式与文本对齐规则。
  - 添加 `.lod-macro` 远景样式（极简直线连线、无双重边框）。
  - 添加顶部工具栏折叠切换按钮 `.toggle-lod-collapse` 的图标与移动端交互尺寸。

### Step 3: 交互绑定、设置面板与生命周期集成
- 修改 `timeline.html` 与 `settings.html`：
  - 在时间线顶部工具栏追加 `.toggle-lod-collapse` 按钮。
  - 在设置面板追加「LOD 性能优化」分栏及对应开关与阈值输入框。
- 修改 `index.js`：
  - 引入 `src/lod-service.js`。
  - 初始化默认配置字段：`enableLodCollapsing: true, lodMinChainLength: 10, enableStyleLod: true, lodTotalNodeThreshold: 100`。
  - 在 `renderCytoscapeDiagram` 拓扑准备阶段接入 `applyLodToElements`。
  - 监听 `cy.on('zoom')` 执行防抖 Style LOD 切换。
  - 监听 `cy.on('tap', 'node[?isCollapsedCluster]')` 点击展开单簇。
  - 绑定工具栏按钮点击切换全局抽稀/全量展开。

### Step 4: 自动化回归测试与实机 CDP 验证
- 运行全量单元测试：`node --test tests/*.test.mjs`，确保现有 37 项测试及新增 LOD 测试全部通过（40+ 项）。
- 编写 CDP 脚本并在运行中的 Luker 实例 (`https://127.0.0.1:8003`) 运行验证：
  - 验证折叠节点渲染与样式。
  - 验证点击折叠节点单簇展开。
  - 验证宏观远景 Style LOD 切换。
  - 验证工具栏折叠按钮切换。
  - 捕获验证截图。
