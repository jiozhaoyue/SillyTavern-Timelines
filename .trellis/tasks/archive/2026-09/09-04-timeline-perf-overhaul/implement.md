# Timeline Performance Overhaul - Implementation Plan

## 1. 任务分期与执行清单 (Ordered Checklist)

### Phase 1: 核心图算法与数据结构去重（消灭致命性能陷阱）
- [x] 1.1 修复 `src/node-data.js` 中 `buildGraph` 的节点与边重复推入 Bug，确保 node 与 edge 在数据中 1:1 唯一。
- [x] 1.2 重构 `src/style.js` 中的 `highlightPathToRoot`，构建哈希映射 `Map<nodeId, node>` 和 `Map<targetId, edge>`，将路径回溯算法时间复杂度从 $O(B \cdot D \cdot N)$ 优化到 $O(B \cdot D)$。
- [x] 1.3 编写 Node.js 单元测试验证 `buildGraph` 去重以及 `highlightPathToRoot` 索引正确性。

### Phase 2: 数据层 IndexedDB 增量持久化缓存
- [x] 2.1 新建 `src/cache.js`，封装基于 IndexedDB 的本地存储（数据库版本、表结构、异步读写、错误降级机制）。
- [x] 2.2 在 `src/node-data.js` 中集成增量同步逻辑：比对服务端返回的聊天列表与本地缓存，仅对新增/活跃聊天发起 `/api/chats/get` 请求。
- [x] 2.3 编写针对 `src/cache.js` 缓存键生成、失效检测与降级容错的测试用例。

### Phase 3: Cytoscape 渲染管线重构与搜索防抖
- [x] 3.1 重构 `src/style.js` 样式规则，将逐元素的 JS 动态样式计算函数替换为 Class 样式类（`.is-user`, `.is-char`, `.is-bookmark`）与 `data(...)` 映射。
- [x] 3.2 优化 `index.js` 中的 Cytoscape 运行时配置，启用 `textureOnViewport` 与 `hideEdgesOnViewport` 提升拖拽与缩放帧率。
- [x] 3.3 为 `index.js` 中的搜索输入添加 250ms 防抖处理，避免高频按键触发全量渲染。

### Phase 4: Dagre 布局异步化 (Web Worker)
- [x] 4.1 新建 `src/layout.worker.js`，在 Worker 线程中独立加载与执行 Dagre 拓扑计算，输出 `{ [id]: { x, y } }` 位置映射。
- [x] 4.2 修改 `index.js` 布局调用流程：通过 Worker 异步计算坐标，完成后调用 Cytoscape `preset` 快速上屏，并内置 Worker 失败或受限环境的自动回退方案。
- [x] 4.3 增加时间线数据更新与布局计算时的轻量状态提示（如“正在计算时间线布局...”）。

### Phase 5: 用户设置面板、缓存管理与集成验证
- [x] 5.1 在 `settings.html` 中增加「缓存与性能管理」区域，提供缓存大小显示与「清理缓存」按钮。
- [x] 5.2 在 `index.js` 中挂载设置项操作与 `/tl r` 强制刷新钩子。
- [x] 5.3 运行全部单元测试，进行端到端逻辑校验与回归验证。

---

## 2. 验证与测试方案 (Validation Commands)

### 自动化测试
```bash
# 运行全部单元测试
node --test tests/*.test.mjs
```

### 手工/逻辑验证项
1. **去重检查**：构建包含分叉和共同前缀的消息序列，验证导出的 Cytoscape elements 中没有重复的节点 ID 或重复边。
2. **算法性能检查**：针对 1000 个节点模拟 20 个检查点，测量 `setupStylesAndData` 耗时，确保在 5ms 以内完成。
3. **缓存读写检查**：模拟角色聊天加载，第一次请求触发拉取并写入 IndexedDB，第二次加载时未变文件网络请求为 0。
4. **Worker 计算与回退**：验证 Worker 正常工作返回坐标，以及在禁用 Worker 时正确回退至主线程布局。
5. **交互一致性**：确认原有功能（节点点击弹出面板、定位节点、分支创建、swipes 切换、高亮图例）行为完全保持一致。

---

## 3. 回滚方案 (Rollback Points)
- 每个 Phase 保持独立提交与模块化边界。若 Web Worker 在特定旧版 WebKit 容器中存在限制，配置开关可随时禁用 Worker 切换回主线程 Dagre。
- 若用户浏览器对 IndexedDB 有严格存储限制，缓存层会自动优雅降级为纯内存缓存或直连加载，不影响主流程运行。
