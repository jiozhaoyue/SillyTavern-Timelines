# 实施设计：Phase 0 E2E 与 Phase 1 检索深化

> 上游设计：`09-25-authority-integration-design`（已归档，§2 能力面 / §4 候选方向 / §5 分期）。
> 本文只写「怎么做」；所有 Authority API 形状以 2026-09-25 逐字段核验为准。

## 0. 环境事实（现场取证，2026-09-25）

| 项 | 值 |
| --- | --- |
| Dev Luker | `https://127.0.0.1:8003`（HTTP 不服务，HTTPS 302 → 登录页） |
| Authority 服务端插件 | `Instance/Dev/Luker/plugins/authority`（在位）；全局控制面 `data/_authority-global`（在位） |
| Authority 前端 SDK | `public/scripts/extensions/third-party/st-authority-sdk`（在位，注入 `window.STAuthority`） |
| Timelines 部署形态 | `public/scripts/extensions/third-party/SillyTavern-Timelines`，git clone，origin = `jiozhaoyue/SillyTavern-Timelines` → **部署 = push origin 后实例内 `git pull`** |
| E2E 宿主 | Node v24（自带全局 WebSocket，可零依赖写 CDP 脚本）；Playwright/chrome CDP 均可（L1-MF-16：回归用 Playwright，一次性诊断用 CDP；本次为回归留证 → 优先 Playwright，不可用则 CDP 脚本） |

## 1. Phase 0：E2E 设计（L1-MF-15 全条合规）

脚本（新增 `tests/e2e/phase0-authority.mjs`，仅本地运行，不进 CI）：

1. **启动断言（先于一切连接）**：`BASE_URL` 未设置 → `process.exit(2)`；解析出的端口不在 `{8001, 8003, 8899}` → 打印「疑似误连 Real 实例」并 `exit(3)`；不读任何实例聊天数据。
2. **登录与加载**：CDP 打开页面，等待 `window.STAuthority?.AuthoritySDK` 与 `window.TimelinesExtensionApi` 就绪（有限次轮询，超时失败）。
3. **验证矩阵**：
   - 适配层状态：设置面板启用语义检索 → `getAuthorityStatus() === 'ready'`；
   - 索引构建：触发 `runSemanticIndexBuild` → 完成回调返回 `upserted>0`；`getSemanticIndexStatus` 返回 `nodeCount>0`；
   - 检索：`semanticSearch`（provider+client 注入）对已知关键词返回命中且 `score>0`；
   - 雷达语义模式：UI 触发后当前图节点高亮（截图 1）；
   - 跨会话弹窗：命中含未打开会话时弹窗行出现（截图 2）；
   - 降级：embedding 端点指向无效地址后重建索引 → `EmbeddingUnavailableError` 路径 toast/状态提示且词法检索仍可用；恢复端点后 `resetFailure` 复位。
4. **产物**：截图存 `tests/e2e/artifacts/`（gitignore），日志含每步断言结果；任何一步失败 → 非 0 退出。

## 2. Phase 1 四件套技术设计

### 2.1 A2 雷达语义筛选接线

- 纯函数（`src/semantic-search-service.js` 新增导出）：
  ```js
  buildSemanticPayloadFilter({ namespace, tags = [], bookmark = false })
  // namespace 存在 → {namespace}; tags 非空 → {tags: {$has?|数组包含}}; bookmark → {bookmark: true}
  ```
  Trivium `payloadFilter` 的标签匹配语义以运行时实测为准（`TriviumSearchHybridRequest.payloadFilter: Record<string, unknown>`，能力文档未细诉）——**先用「值相等/数组包含」两种形态在 Phase 0 实测确认，再固化实现**；若 filter 不支持数组包含，退化为多次查询按 tags 前端过滤（仍零权限）。
- 接线（`src/search-radar.js`）：语义模式筛选气泡面板新增「标签」「书签」控件；标签候选来自 `extractNodeTags` 的当前图去重集合；触发时经 `semanticSearch` 传入。
- 降级：筛选后 0 命中显示现有空态；Authority 非 ready 时整个语义模式休眠（现状不变）。

### 2.2 A3 跨角色全局检索

- 索引端：`runSemanticIndexBuild` / `SemanticIndexer` 新增可选 `namespaceLabel`（index.js 从宿主上下文取角色/群组显示名传入）；payload 增补 `namespaceLabel`（`buildNodePayload` 不动，注入点在 build 的 payload 组装处）。旧条目无该字段 → UI 回退显示 namespace 键（`char_N`）。
- 检索端：`semanticSearch` 新增 `scope: 'character' | 'global'`（默认 `'character'`）；`'global'` 时 `payloadFilter` 不含 namespace。
- 设置：`settings.semanticGlobalScope`（bool，默认 false），设置面板开关；雷达语义模式的结果弹窗行新增来源徽标（`namespaceLabel ?? namespace`），并按来源分组（分组纯函数 `groupGlobalResultsByNamespace(rows)` Node 可测）。

### 2.3 D1 全库统计物化

- 纯函数（`src/analytics-service.js` 新增）：`aggregateIndexStateByNamespace(rows)` → `[{namespace, indexedCount, lastIndexedAt}]`（SQL 行已是聚合结果时直接整型化）。
- IO（`src/semantic-index-service.js` 新增导出）：`getGlobalIndexStats({client})` →
  `sql.query({database:'main', statement:'SELECT namespace, COUNT(*) AS cnt, MAX(indexed_at) AS last_at FROM index_state GROUP BY namespace ORDER BY cnt DESC'})`（index_state 已存在，无迁移新增）。
- UI（`src/analytics-modal.js`）：看板底部「全库语义索引聚合」区块，仅 `getAuthorityStatus()==='ready'` 时渲染；渲染数据来自上面聚合；失败静默隐藏该区块。

### 2.4 A1 neighbors 语义上下文

- 纯函数（`src/semantic-search-service.js` 新增）：
  - `expandHitWithContexts(hits, neighborsById, resolveExternalId)` — 把 `{id, externalId, payload}` 命中与 neighbors 结果拼装为 `{hit, context:[{externalId, payload}]}`；
  - neighbors 响应 `{ids: number[], nodes?: TriviumResolvedNodeReference[]}`（`shared-types/trivium.ts:155,377`）。
- IO：命中后对 top N（≤5）逐个 `client.trivium.neighbors({database, id: hit.id, depth: 1})`；**特性检测**：`typeof client.trivium.neighbors !== 'function'` 或调用抛错 → 跳过上下文（空数组），不报错不重试。
- UI：雷达语义模式命中卡片附「上下文 ±1 楼」折叠段（preview 文本来自 neighbors payload）。

### 2.5 权限不变量

- `AUTHORITY_DECLARED_PERMISSIONS` 不动；`tests/authority-adapter.test.mjs` 已有负断言保持通过；四件套全部只消费 `trivium.*` 与 `sql.*` 既有授权面。

## 3. 测试与部署

1. 单测：新增 `tests/semantic-filter.test.mjs`（A2 纯函数）、扩展 `tests/semantic.test.mjs`（A3 scope/group/namespaceLabel 回退、A1 拼装与降级）、扩展 `tests/analytics.test.mjs`（D1 聚合）；基线 124 项全绿 + 新增全绿。
2. `node --check` 全部改动文件。
3. 部署：push origin → 实例目录 `git pull --ff-only`（L0-1 合规；`git -C public/scripts/extensions/third-party/SillyTavern-Timelines pull --ff-only`）→ 刷新页面复验 Phase 0 矩阵 + 四件套实机冒烟。
4. 收口：spec `optional-integration.md` 回填宿主可用性结论与新 payload 字段说明；任务归档。

## 4. 风险与对策

| 风险 | 对策 |
| --- | --- |
| `payloadFilter` 数组包含语义不明 | Phase 0 实测两种形态后固化；退化路径为前端过滤 |
| 实例的 Timelines 版本落后本仓（旧代码先被 E2E） | Phase 0 先跑现状基线；Phase 1 代码 push+pull 后复验 |
| Luker 宿主 Authority 兼容性未知 | Phase 0 即为其验证；失败则结论回填 spec 并止步（Phase 1 仍可交付，功能在 ST 8001 可用） |
| neighbors 在大库上的延迟 | 限 top 5 命中、depth 1、异步不阻塞雷达渲染（L1-MF-11） |
