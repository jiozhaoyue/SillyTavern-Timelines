# 实施计划: 时间线分支高级管理与差异对比 (Implementation Plan)

## 实施步骤分工

### Phase 1: 差异对比纯算法与单元测试 (`src/diff-service.js` & `tests/diff.test.mjs`)
- [x] 实现 `computeBranchLCA(pathA, pathB)` 纯函数：计算分叉点与左右差异列表。
- [x] 实现 `extractPathForNode(nodeId, nodeMap, parentEdgeMap)`：极速提取单链路径。
- [x] 编写全套自动化单元测试：覆盖正常分叉、一条分支是另一条的前缀、完全相同分支、空分支等边界情况。

### Phase 2: 分支操作与宿主联动 (`src/branch-manager.js`)
- [x] 实现 `createBranchFromNode(node)`：安全从选定节点派生分支、切换会话并协同更新缓存（严格基于酒馆原生 `createBranch`）。
- [x] 实现 `deleteBranchFile(fileName, characterAvatar)`：调用后端接口清理废弃分支并广播事件。

### Phase 3: 右键上下文菜单集成与主题美化 (`src/context-menu.js` & `style.css`)
- [x] 初始化 `cytoscapeContextMenus` 插件，注册节点与画布上下文菜单项。
- [x] 编写样式，符合酒馆暗色毛玻璃与高对比度交互规范。

### Phase 4: 多分支差异对比弹窗 (`src/diff-modal.js`)
- [x] 动态创建/挂载 `#timelinesDiffModal`。
- [x] 左右双栏对比渲染、LCA 分叉点摘要、一键切换会话功能。

### Phase 5: 主入口联动与自动化验证 (`index.js` & 实机 CDP 测试)
- [x] 在 `renderCytoscapeDiagram` 中绑定上下文菜单。
- [x] 运行测试套件与 CDP 自动化验证。
