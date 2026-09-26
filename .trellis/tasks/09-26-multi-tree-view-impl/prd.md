# 多树视图实施（跨角色/群组同屏）

## Goal

按 `09-26-multi-tree-view-design` 的设计（用户已裁定通过，决策点采纳推荐 D1a/D2a/D3a/D4a/D5b）实施多树视图：
单 Cytoscape 画布同屏渲染 N 棵时间树（角色/群组混合），树内布局复用现有 Worker+Dagre，树间网格平移拼装；
单树路径零回归。

## Requirements

- R1 纯函数模块 `src/multi-tree.js`：树 id 生成（`char_<id>`/`group_<id>`，对齐语义 namespace 惯例）、
  元素作用域化（`scopeTreeElements`：重写 data.id / edge source/target / storedSwipes 内层 id，打 `treeId` 数据字段，
  **不改** chat_sessions/file_name/bookmarkName 等导航字段）、网格拼装（`composeMultiTreePositions`，确定性输出）、
  预算校验（桌面 ≤4 / 移动 ≤2 棵，超限取数前拒绝）。全部 Node.js 100% 可单测（L1-MF-11）。
- R2 数据面：`prepareDataProgressive` 增加可选 `scopeContext` 参数（缺省 = 现行为，零回归），
  非当前树按目标角色/群组构造 scopeContext，缓存 scopeKey 落到正确的角色/群组（不许串scope）。
- R3 编排层（index.js）：多树模式为单树画布的**模式**——进入（目标选择器→逐树取数/构建/布局/拼装→单 cy 渲染）、
  退出（恢复单树管线）、`lastContextKey` 带 mode 维度；CHAT_CHANGED 失效语义保持正确。
- R4 语义构建护栏：多树模式下 `triggerSemanticBuild` 与 `maybeAutoSemanticIndex` 必须拒绝执行
  （union 元素写入当前 namespace = 污染），手动按钮给出提示 toast，自动路径静默跳过。
- R5 导航：`navigateToMessage` 增加可选 `treeId`——目标树为其他角色时先 `selectCharacterById` 再走原逻辑；
  群组树 v1 维持上游 TODO 现状（仅当前群组上下文可跳）。
- R6 UI：时间线工具栏新增「多树」按钮；目标选择器为 JS 动态模态（勾选角色/群组，默认勾当前角色，
  预算内可多选）；多树模式顶部横幅（树集合 + 退出按钮）。样式双前缀纪律（`timelines-multitree-*`，L0-10）。
- R7 关键节点保护不变量在每棵树内独立成立（L1-MF-11）；多树间无边（L1-MF-4：不造跨角色边）。

## Acceptance Criteria

- [ ] `node --test tests/*.test.mjs` 全绿（基线 147 + multi-tree 新增用例：id 重写完整性 / 归组隔离 /
      storedSwipes 重写 / 拼装确定性 + 网格不重叠 / 预算拒绝 / treeId 关键节点参数化）。
- [ ] `BASE_URL=https://127.0.0.1:8003 node tests/e2e/phase0-authority.mjs` 全绿（基线 10 步 + 步骤 11：
      进入多树 → ≥2 棵树共存且每边 source/target 前缀一致（无跨树边）→ 退出恢复单树）。
- [ ] 单树功能零回归：原 10 步 E2E 与既有单测不改断言即通过。
- [ ] 多树模式下语义构建被护栏拦截（单测覆盖 makeTreeId/scope/compose 的同时，护栏逻辑经 E2E 或单测验证）。
- [ ] 实机冒烟：Dev Luker 上进入多树（2 角色）渲染成功，节点点击跳转到对应角色对应楼层。
- [ ] 实时勾选 implement.md，任务收口时归档并推送。
