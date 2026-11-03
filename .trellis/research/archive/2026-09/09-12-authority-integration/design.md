# 技术设计：Authority 语义检索索引与跨会话搜索

## 1. 总体架构

新增 4 个独立模块 + 1 个适配器，全部为**可选旁路**，主图谱链路（渲染/分支/合并/导出）不感知其存在：

```
index.js (启动编排, 只加两行)
  └─ initAuthorityAdapter()  ── 能力嗅探 window.STAuthority?.AuthoritySDK
        │                        失败 → 全模块静默休眠
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │ authority-adapter.js      状态机: absent/connecting/     │
  │                           ready/error/disabled + 订阅   │
  └──────┬─────────────────────────┬────────────────────────┘
         ▼                         ▼
  semantic-index-service.js   semantic-search-service.js
  (枚举→diff→embed→写入)      (searchHybrid→映射/展示)
         │                         │
         ▼                         ▼
  embedding-provider.js        search-radar.js (语义模式)
  (POST /api/embeddings/       semantic-global-modal.js
   compute, 批量+缓存)          (跨会话结果+穿越)
         │
         ▼
  Trivium (tl_vec_<dim>) + SQL (index_state)   ← 全部为可重建派生数据
```

## 2. 模块契约

### 2.1 `src/adapters/authority-adapter.js`

```js
// 状态机（纯逻辑可测）：absent | disabled | connecting | ready | error
export function createAuthorityStateMachine()          // -> {transition(event), get(), subscribe(fn)}
export async function initAuthorityAdapter()           // 嗅探+init，挂状态；返回 boolean（是否 ready）
export async function getAuthorityClient()             // ready 后 resolve client；否则 reject {code}
export function getAuthorityStatus()                   // -> {status, reason?, databaseName?}
export function onAuthorityStatusChange(fn)            // -> unsubscribe
```

- `extensionId: 'third-party/sillytavern-timelines'`，version 取 `manifest.json`。
- `declaredPermissions`: `{trivium: {private: true}, sql: {private: true}, storage: {kv: true}, jobs: {background: ['sql.backup', 'trivium.flush']}}`（最小权限）。
- init 抛错（插件未装/被拒）→ `error` 状态，永不重试风暴（错误态 60s 冷却）。

### 2.2 `src/embedding-provider.js`（纯逻辑 + 薄 IO）

```js
export function hashText(text)                          // -> 同步字符串哈希（缓存键）
export function chunkTexts(texts, batchSize)            // -> 批次二维数组（纯函数，可测）
export function createEmbeddingProvider({endpoint, batchSize, getHeaders, fetchImpl})
  // -> { embed(texts) -> Promise<number[][]>, dim?, resetFailure() }
```

- 默认 `endpoint: '/api/embeddings/compute'`，body `{text}`，响应 `{embedding}`；`getHeaders` 用 ST `getRequestHeaders()`（从 `'../../../../script.js'` import，index.js 已有同类先例）。
- 连续 3 批失败 → 抛 `EmbeddingUnavailableError`，由上层置 `error`。
- 内存缓存 `Map<hashText, vector>`，会话生命周期。

### 2.3 `src/semantic-index-service.js`（核心，纯算法与 IO 分离）

**纯函数（必须单测）**：
```js
export function encodeExternalId(chatFile, messageId)   // -> `${chatFile}::${messageId}`
export function decodeExternalId(externalId)            // -> {chatFile, messageId} | null
export function buildNodePayload(nodeData, chatFile, messageId)
  // -> {chatFile, messageId, name, is_user, depth, tags, bookmark, preview(≤200字)}
export function computeContentHash(nodeData, chatFile, messageId)  // -> 稳定字符串哈希
export function diffIndexState(entries, stateRows)
  // entries: [{chatFile, messageId, nodeData, hash}]
  // stateRows: [{chat_file, message_id, content_hash, trivium_db}]
  // -> {upserts[], deletes[], unchangedCount}     ← 增量算法核心
export function buildFloorLinks(entries)
  // 同 chatFile 内按 messageId 排序，相邻建边
  // -> [{src:{externalId}, dst:{externalId}, label:'next', weight:1}]
```

**IO 编排类**：
```js
export class SemanticIndexer {
  constructor({client, provider, namespace})            // namespace = 角色名/头像作用域键
  async build({elements, onProgress, forceRebuild})     // 全量枚举→diff→分批 embed→bulkUpsert
                                                        //   →逐批 indexText→buildFloorLinks→bulkLink
                                                        //   →SQL 更新 index_state→可选 flush
  async cancel()                                        // 中断（分批间检查）
  async getStatus()                                     // trivium.stat + index_state 计数
}
```

数据映射（关键决策）：
- **Trivium 库名**：`tl_vec_<dim>`（dim 来自 provider 首批 embedding）。维度变化 → 新库，旧库保留；状态表记录 `trivium_db` 字段，跨库 diff 时旧库条目视为待删除候选（UI 提示，不自动删其他库）。
- **namespace**：聊天作用域键（角色名，与 `timelinesCache` 的 scopeKey 同源）——多角色共用一个 Trivium 库时按 namespace 隔离；`payloadFilter`/TQL 按需过滤。
- **枚举源**：直接用图谱 elements——每个 `nodeData.chat_sessions` 已含所有分支会话的 `{chatFile: {messageId}}` 映射（跨会话去重树已合并全部分支），无需再单独扫文件。
- **SQL**：
  ```sql
  CREATE TABLE IF NOT EXISTS index_state (
    chat_file TEXT NOT NULL, message_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL, trivium_db TEXT NOT NULL,
    indexed_at TEXT NOT NULL, PRIMARY KEY (chat_file, message_id));
  ```

### 2.4 `src/semantic-search-service.js`

```js
export function mapHitsToNodes(hits, graphElements)     // hit.externalId → 当前内存 nodeData（纯函数，可测）
export function formatGlobalResults(hits)               // -> 跨会话结果行 [{chatFile, messageId, preview, score, name, is_user}]
export async function semanticSearch({client, provider, database, queryText, topK, payloadFilter})
  // queryText → embed → trivium.searchHybrid({vector, queryText, topK, hybridAlpha:0.5}) -> hits
```

### 2.5 UI 接缝（改动既有文件最少化）

| 文件 | 改动 |
|---|---|
| `index.js` | 启动序列加 `initAuthorityAdapter()`；设置区新增绑定（约 3 处小改） |
| `src/search-radar.js` | `initUI`/`executeSearch` 增加语义模式分支：模式按钮仅在 `getAuthorityStatus()==='ready'` 且索引非空时注入；语义路径调 `semanticSearch` → `mapHitsToNodes` → 复用现有 matches/step/dim 机制 |
| `settings.html` | 新增"语义检索 (Authority)"inline-drawer：开关、endpoint、批大小、构建/重建按钮、状态行 |
| `style.css` | 语义模式徽章与全局结果列表样式（沿用现有变量） |
| 新 `src/semantic-global-modal.js` | 跨会话结果弹窗，跳转复用 snapshot-modal.js:202-209 模式（`openCharacterChat` + `navigateToMessage`） |

## 3. 数据流（一次语义查询）

1. 用户在雷达输入查询，切到语义模式 → `semanticSearch`。
2. `provider.embed([queryText])` 得查询向量。
3. `trivium.searchHybrid({database: 'tl_vec_<dim>', vector, queryText, topK: 30})`。
4. hits 拆两路：能映射进当前图的 → 雷达步进高亮；映射不进的（其他分支会话）→ 弹窗列表提供"穿越"。
5. 任何一步失败 → toast 提示 + 雷达自动回退词法模式。

## 4. 权衡与备选

- **外部 ID vs 内部 id**：选 externalId（官方维护映射、增量 diff 无需缓存数字 id）；代价是 upsert 响应才拿得到 indexText 所需内部 id —— 接受（逐批处理，响应即取即用）。
- **embedding 缓存**：只做内存级。理由：向量本体已在 Trivium 持久化，重复构建经 content_hash diff 后本就跳过绝大多数节点，SQL 级缓存收益趋零。
- **不做库自动删除**：维度切换后旧库保留，避免误删；UI 提示用户可在 Security Center 清理。
- **跨会话跳转**：直接复用快照模式的原生 API 调用序列，不引入新抽象。

## 5. 兼容与回滚

- 全部改动 additive；新设置默认关闭；无 Authority 时所有新模块在 `absent` 状态短路（含 UI 注入点）。
- 回滚 = revert 提交；无原生数据迁移，Trivium/SQL 残留数据可随时手动清除，不影响插件功能。
- 测试策略：纯函数全覆盖（externalId 编解码、diff、links、payload、批处理、状态机、hits 映射）；IO 层用注入 fetch/SDK stub 测降级路径。
