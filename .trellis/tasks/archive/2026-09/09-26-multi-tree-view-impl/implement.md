# 多树视图实施 — 执行清单

> 复选框随执行实时勾选（L0-2）。设计依据：`../09-26-multi-tree-view-design/design.md`（已裁定通过）。

## A. 纯函数模块与单测

- [x] A1 `src/multi-tree.js`：`makeTreeId` / `MAX_TREES_BY_PROFILE` / `assertTreeBudget`
- [x] A2 `scopeTreeElements(elements, treeId)`：data.id + edge source/target + storedSwipes 内层 id 重写，
      全元素打 data.treeId；不触碰 chat_sessions/file_name/bookmarkName；纯函数（不修改入参）
- [x] A3 `composeMultiTreePositions(treeLayouts, { columns })`：网格平移向量 + 合并 positions + boundingBoxes，确定性
- [x] A4 `buildMultiTreeElements(scopedTrees)`：拼接 + 全局 id 唯一性不变量（Set 校验，L1-MF-11 强去重）
- [x] A5 `tests/multi-tree.test.mjs`：上述全路径 + 关键节点不变量参数化 × N 树

## B. 数据面

- [x] B1 `src/node-data.js` `prepareDataProgressive` 增加 `scopeContext` 可选参数（缺省现行为），
      scopeKey / activeChat / character 查找全部改用 scopeContext ?? getTimelinesContext()

## C. 编排层（index.js）

- [x] C1 `multiTreeState` 模块级单例（L1-MF-12 状态收敛）+ `enterMultiTreeMode(targets)` /
      `exitMultiTreeMode()`
- [x] C2 逐树取数：角色 fetchData(avatar) / 群组 group.chats 组装；逐树 prepareDataProgressive（scopeContext）
- [x] C3 逐树 scopeTreeElements → layoutService.computeLayout（Worker 内排队）→ composeMultiTreePositions
- [x] C4 渲染：单 cy 实例 preset positions；lastTimelineData = 并集；lastContextKey 追加 mode 维度
- [x] C5 语义护栏：triggerSemanticBuild / maybeAutoSemanticIndex 多树模式拒绝（手动 toast / 自动静默）
- [x] C6 导航：utils.navigateToMessage 增可选 treeId（跨角色先 selectCharacterById）；dbltap 等 4 处调用点传 treeId

## D. UI

- [x] D1 工具栏「多树」按钮（index.js 模态模板 export-timeline-btn 同级）
- [x] D2 目标选择器动态模态（角色+群组勾选、默认勾当前、预算约束）
- [x] D3 多树模式横幅（树集合徽标复用 namespaceLabel 样式 + 退出按钮）
- [x] D4 样式 `timelines-multitree-*` 双前缀 + 宿主变量回退（L0-10）

## E. 验证与收口

- [x] E1 node --check 全部改动文件
- [x] E2 node --test 全绿（147 基线 + 新增）
- [x] E3 E2E 步骤 11（多树进入/共存/无边/退出）→ 11/11 全绿（跨树 dbltap 导航未 E2E 化：需 cy 实例引用模拟双击，v1 覆盖缺口；核心索引解析已提纯函数 resolveTreeCharacterIndex 并单测）
- [x] E4 实机冒烟（Dev Luker 8003）
- [x] E5 git commit + push；add_session 记录；任务归档
