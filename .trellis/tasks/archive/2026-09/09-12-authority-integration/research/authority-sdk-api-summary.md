# Authority (ST-Delegation-of-authority) SDK 集成参考

> 调研日期：2026-09-12。来源：仓库 README、`docs/server/http-api.md`、`docs/server/ai-integration-guide.md`、`managed/sdk-extension/client.js`（反编译源码）、`packages/shared-types/src/*.ts`。原始文件已保存在本目录（`authority-*.md` / `authority-*.js` / `authority-*.ts`）。

## 1. 定位与边界（必读）

- Authority 是 **SillyTavern 服务端插件**（`plugins/authority`，需 `enableServerPlugins: true`），安装后自动向浏览器部署 SDK 扩展（`st-authority-sdk`）。
- 给第三方前端扩展提供：按用户+扩展隔离的 SQLite、Trivium 向量图数据库、KV/Blob/私有文件、HTTP 代理、后台任务、SSE 事件流、Agent Runtime。
- **浏览器只允许通过 `window.STAuthority.AuthoritySDK` 访问**；严禁直接 fetch `/v1/*` 或猜测 core 端口（官方 AI 集成指南明确禁止）。
- **Authority 不生成 embedding**：Trivium 检索接口一律要求调用方自带 `vector`。向量需由 Timelines 侧自行生成（ST 原生 `/api/embeddings/compute`）。
- jobs 仅内置 4 种：`delay`、`sql.backup`、`trivium.flush`、`fs.import-jsonl`。不是任意代码执行平台。

## 2. 可用性探测与初始化

```js
// 探测（不建立会话）
const probe = await window.STAuthority.AuthoritySDK.probe(); // -> probe 快照（含 features/limits）

// 初始化（幂等；同 extensionId 重复 init 返回同一 client）
const client = await window.STAuthority.AuthoritySDK.init({
  extensionId: 'third-party/sillytavern-timelines',   // 命名规范：third-party/<name>
  displayName: 'SillyTavern Timelines',
  version: '2.4.0',                                    // 建议 manifest.json 同步
  installType: 'local',
  declaredPermissions: { ... },                        // 见下
});
```

`window.STAuthority` 仅保证挂载 `AuthoritySDK` 与 `openSecurityCenter()`。探测时务必做空值防御：`window.STAuthority?.AuthoritySDK`。

## 3. 权限声明（shared-types/src/permissions.ts 原文）

```ts
interface DeclaredPermissions {
  storage?: { kv?: boolean; blob?: boolean };
  fs?: { private?: boolean };
  sql?: { private?: boolean | string[] };
  trivium?: { private?: boolean | string[] };   // string[] = 指定数据库名白名单
  http?: { allow?: string[] };
  jobs?: { background?: boolean | string[] };
  events?: { channels?: boolean | string[] };
  agent?: { run?: boolean | string[]; browser?: boolean | string[] };
}
```

- 每次实际调用前 SDK 会 `ensurePermission({resource, target, reason})`；未授权时触发用户授权弹窗（allow-once / allow-session / allow-always / deny）。
- 普通资源默认放行；`agent.run` / `agent.browser` 默认需 prompt。
- Timelines 应声明：`trivium.private`、`sql.private`、`storage.kv`、`jobs.background`。**不要声明 agent / fs / http**（最小权限）。

## 4. Trivium API（本集成核心）

DTO 见 `authority-trivium-types.ts`。关键点：

- 节点引用：`{ id?: number, externalId?: string, namespace?: string }`。**externalId 是字符串稳定 ID**，官方会维护映射，推荐用 externalId 而非内部数字 id。
- 库名：`database` 可自定义；不传默认 `'default'`。权限 target = 库名。
- 首次写入决定向量维度（`dim`），之后必须一致；`dtype` 支持 `'f32'|'f16'|'u64'`。

### 写入
```js
// 单节点 upsert（externalId 存在则更新）
await client.trivium.upsert({ database, externalId, namespace, vector, payload });
// -> { id, action: 'inserted'|'updated', externalId, namespace }

// 批量 upsert（SDK 自动分块）
await client.trivium.bulkUpsert({ database, items: [{ externalId, namespace, vector, payload }, ...] });
// -> { totalCount, successCount, failureCount, failures: [{index, message}], items: [{index, id, action, externalId}] }

// 建边（支持 externalId 引用，无需先查内部 id）
await client.trivium.bulkLink({ database, items: [
  { src: {externalId: 'a'}, dst: {externalId: 'b'}, label: 'next', weight: 1 }, ...] });

// 删边 / 删节点
await client.trivium.bulkUnlink({ database, items: [{src:{externalId}, dst:{externalId}}] });
await client.trivium.bulkDelete({ database, items: [{externalId}] });
```

### 检索
```js
// 混合检索（向量 + BM25 文本，vector 必传）
const hits = await client.trivium.searchHybrid({
  database, vector, queryText: '龙与城堡',
  topK: 20, minScore: 0, hybridAlpha: 0.5,          // hybridAlpha: 向量/文本权重
  payloadFilter: { 'chatFile': 'xxx' },              // TriviumFilterCondition = Record<string, unknown>
});
// hits: [{ id, externalId, namespace, score, payload }]
```

- `search({vector, topK, minScore, expandDepth})` 纯向量；`searchAdvanced` 带 BM25 参数与 `forceBruteForce: true`（精确召回，节点 ≥10000 时默认走近似索引）。
- `searchHybridWithContext(...)` 返回 `{hits, context: {stageTimings, ...}}`，调试用。
- **所有检索接口都要求 `vector`**：纯文本服务端检索不可行；无 embedding 后端时应整体降级关闭语义搜索（词法/正则检索本来就在前端实现）。
- `indexText({id, text})` / `indexKeyword` / `buildTextIndex`：为 BM25 通道建文本索引。写节点后调用 `indexText`（按内部数字 id），否则 queryText 通道无内容可匹配。id 从 upsert 响应拿。
- `payloadFilter` 生效依赖 payload 属性索引：`createIndex({database, field: 'chatFile'})`。

### 维护
```js
await client.trivium.flush({database});    // WAL 落盘（也有 trivium.flush job）
await client.trivium.stat({database});     // -> {nodeCount, edgeCount, vectorDim, mappingCount, indexHealth...}
await client.trivium.compact({database});  // 压实（维护操作，勿高频）
```

## 5. SQL / KV（增量索引状态存储）

```js
await client.sql.migrate({database: 'main', migrations: [{id: '001_init', statement: 'CREATE TABLE IF NOT EXISTS ...'}]});
const r = await client.sql.query({database: 'main', statement: 'SELECT ...', params: [...]});
await client.sql.exec({database: 'main', statement: 'INSERT ...', params: [...]});
await client.storage.kv.set({key, value}); await client.storage.kv.get({key}); // -> {value}
```

- 数据库按 用户+扩展 隔离；分页 `page: {limit}`（默认 100，最大 1000）。
- 也可以用 `client.jobs.create({type: 'sql.backup', payload})` 做备份任务。

## 6. 事件流（SSE）

```js
const unsubscribe = await client.events.subscribe({channel: 'extension:third-party/sillytavern-timelines'}, (event) => {...});
```

仅 SSE、单用户。对本集成非必需（索引进度用回调即可），声明保留备用。

## 7. Embedding 生成（Timelines 侧职责）

- ST 原生端点：`POST /api/embeddings/compute`，body `{ text }`（或 `{ text, backend }`），响应 `{ embedding: number[] }`；请求头用 ST 的 `getRequestHeaders()`（可从 `script.js` import，index.js 已有从 `'../../../../script.js'` import 的先例）。
- 必须做成**可插拔 provider**：端点 URL、维度、批大小可配；失败时整体降级（禁用语义搜索并提示），绝不能让主图渲染链路受影响。
- 常见默认维度：OpenAI text-embedding-3-small = 1536；本地 transformers = 384。Trivium `dim` 由首次 upsert 隐式确定，换 embedding 后端 = 维度变化 = **必须换库名**（设计用 `tl_vec_<dim>` 命名规避冲突）。

## 8. 已确认的反模式（官方指南原文约束）

1. 不把 `trivium.private` 当 embedding 服务。
2. 不在高频路径调用 `checkMappingsIntegrity` / `deleteOrphanMappings` / `stat({includeMappingIntegrity: true})`（重诊断）。
3. 不直接访问 `/v1/*`、不拼 `x-authority-core-token`。
4. 不绕过 PermissionService（SDK 已内建 ensurePermission，直接用 SDK 即可）。
5. jobs 不做任意代码执行。

## 9. 与 Timelines 哲学的相容性

Timelines 核心哲学是「零私有数据库、message.extra 唯一数据源」（WIKI.md §1.2）。Authority 集成必须定位为：**服务端只保存可随时重建的派生索引/投影**（向量索引 + 增量状态表），删除 Authority 不影响任何原生数据；索引可全量重建。这让插件在"无 Authority 环境"零影响、在"有 Authority 环境"获得前端无法独立实现的能力（持久跨会话语义检索、服务端 BM25、后台备份）。
