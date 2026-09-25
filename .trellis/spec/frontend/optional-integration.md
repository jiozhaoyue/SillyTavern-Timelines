# Optional Integration & Node-Testable Module Conventions

> 沉淀自任务 `09-12-authority-integration`（Authority 服务端集成）。适用于前端插件的第三方能力接入与纯逻辑模块设计。

---

## 1. 可选外部插件集成约定（Authority 范式）

当接入"可能不存在"的外部宿主能力（如 Authority 服务端插件的 `window.STAuthority`）时，必须遵循：

1. **能力嗅探 + 全空值防御**：所有探测点写成 `window.STAuthority?.AuthoritySDK`；模块级单例状态机（`absent / disabled / connecting / ready / error`）统一管理生命周期，禁止散落的布尔标记。
2. **零硬依赖**：未安装时全模块静默休眠（`absent` 短路），主链路零新增 console error、零 UI 空壳。UI 注入点必须容忍"就绪晚于 UI 创建"（有限次重试 + 单次状态订阅，禁止无界重试风暴；错误态冷却 60s）。
3. **最小权限声明**：只声明实际调用到的权限；绝不顺手声明 `agent.*` / `fs.*` / `http.*`，未使用的能力（如 `storage.kv`、`jobs.background`）同样不得声明——多余声明会让用户在 Security Center 授权弹窗看到不存在的风险项。当前实际使用面仅 `trivium.private` 与 `sql.private`（2026-09-25 审计修正）。
4. **派生数据唯一原则**：外部服务端只允许保存"可随时全量重建的派生投影"（向量索引、状态表）。原生 `message.extra` / `chat.jsonl` 永远是唯一数据源——卸载外部插件后插件功能必须完好。
5. **降级路径显式化**：任何集成失败（断网/拒权/维度切换）只降级该功能自身并向用户 toast 说明，绝不静默吞错、绝不波及词法检索等既有功能。

参考实现：`src/adapters/authority-adapter.js`（状态机）、`src/semantic-index-service.js`（派生索引）。

## 2. Node 可测模块约定（纯逻辑 / IO 分离）

前端插件目前没有构建步骤与打包器，测试用 `node --test`。要让模块能被 Node 直接导入：

1. **禁止静态导入宿主模块**：`script.js`、`extensions.js`、jQuery、`toastr` 等只能在 `index.js`（浏览器入口）导入；src 下的纯逻辑模块一律通过参数注入（如 `getHeaders`、`fetchImpl`、`client`、`provider`）。
2. **纯函数与 IO 编排分离**：同一文件内导出纯函数（编解码、diff、格式化、分块）+ IO 类/编排函数（注入依赖）。测试只打纯函数与注入桩。
3. **浏览器专用 DOM 模块**（如 `*-modal.js`）可自由用 DOM/jQuery，但要求 `typeof document === 'undefined'` 时安全短路，且不参与纯逻辑测试。
4. **确定性**：纯函数输入输出稳定可哈希（如 `hashText` FNV-1a）；需要"内容是否变化"判断时一律用内容指纹，而非时间戳。

---

## 3. Authority SDK API 对齐矩阵（2026-09-25 逐字段核验）

> 核验基准：`ST-Delegation-of-authority`（jiozhaoyue fork）`packages/shared-types/src/*.ts` 与
> `packages/sdk-extension/src/{index,sdk,client}.ts`。Timelines 侧契约定义在
> `src/adapters/authority-adapter.js`；调用方为 `src/semantic-index-service.js` 与
> `src/semantic-search-service.js`。宿主升级后如遇"语义功能静默失效"，先重对本矩阵。

**接入入口**

| Timelines 侧 | Authority 侧 | 结论 |
| --- | --- | --- |
| `window.STAuthority?.AuthoritySDK` | `sdk-extension/src/index.ts:7` 挂载 `window.STAuthority = { AuthoritySDK, openSecurityCenter }` | 一致 |
| `AuthoritySDK.init({extensionId, displayName, version, installType, declaredPermissions})` → `Promise<client>` | `AuthorityInitConfig`（`shared-types/session.ts`）+ `static async init`（`sdk.ts:13`，按 extensionId 幂等加锁） | 一致 |
| `extensionId: 'third-party/sillytavern-timelines'` | 服务端 owner id 段模式 `third-party/<name>`（`module-discovery-service.ts:39`） | 一致 |
| `installType: 'local'` | `InstallType = 'system' \| 'local' \| 'global'` | 一致 |
| `declaredPermissions: {trivium: {private: true}, sql: {private: true}}` | `DeclaredPermissions`（`permissions.ts`：`trivium.private`/`sql.private` 接受 `boolean \| string[]`，string[] 为按名允许清单） | 一致 |

**trivium 能力面（client.trivium.\*）**

| 调用（Timelines） | DTO（shared-types/trivium.ts） | 结论 |
| --- | --- | --- |
| `bulkUpsert({database, items:[{externalId, namespace, vector, payload}]})` | `TriviumBulkUpsertItem = TriviumNodeReference{id?,externalId?,namespace?} + {vector, payload}` | 一致 |
| 取 `resp.items[].{externalId, id}` 供 `indexText` | `TriviumBulkUpsertResponseItem{index,id,action,externalId,namespace}` | 一致 |
| `bulkDelete({database, items:[{externalId}]})` | `TriviumNodeReference[]` | 一致 |
| `bulkLink({database, items:[{src:{externalId},dst:{externalId},label,weight}]})` | `TriviumBulkLinkItem` | 一致 |
| `searchHybrid({database, vector, queryText, topK, hybridAlpha, payloadFilter})` | `TriviumSearchHybridRequest`（全字段同名）→ `TriviumSearchHit[] {id, externalId?, score, payload}` | 一致 |
| `indexText({database, id, text})` / `createIndex({database, field})` / `flush({database})` | `TriviumIndexTextRequest` / `TriviumCreateIndexRequest` / `TriviumFlushRequest`（均 extends `TriviumOpenOptions{database?}`） | 一致 |
| `stat({database})` 取 `{nodeCount, edgeCount, vectorDim}` | `TriviumStatResponse` | 一致 |

**sql 能力面（client.sql.\*，库 `main`，表 `index_state`）**

| 调用 | DTO（shared-types/sql.ts） | 结论 |
| --- | --- | --- |
| `migrate({database, migrations:[{id, statement}]})` | `SqlMigrationInput{id, statement}` | 一致 |
| `query({database, statement, params})` → `resp.rows` | `SqlQueryRequest` → `SqlQueryResult{rows: Record<string, SqlValue>[]}` | 一致 |
| `batch({database, statements:[{statement, params}]})`（失败逐条 `exec` 兜底） | `SqlBatchRequest{statements: SqlStatementInput[]}` | 一致 |
| `exec({database, statement, params})` | `SqlExecRequest` | 一致 |

**派生投影边界（重申）**：向量索引 + `index_state` 状态表全部为原生 `message.extra` 的可重建投影；
`private: true` 为整库私有（库名 `tl_vec_<dim>` 动态派生，故不能用 string[] 按名清单）。

---

## 4. 宿主可用性实证与运行时实测语义（2026-09-25 Dev Luker 8003 E2E）

> 来源：任务 `09-25-authority-phase0-phase1` Phase 0 实机 E2E（`tests/e2e/phase0-authority.mjs`，
> L1-MF-15 启动断言：`BASE_URL` 无默认值 + Dev 端口白名单 `{8001, 8003, 8899}`）。宿主升级或
> 换宿主后，重跑该脚本即可复核本节全部结论。

### 4.1 宿主可用性结论（L0-12 的实证标注）

| 宿主 | Authority 可移植子集（SDK + server plugin） | 说明 |
| --- | --- | --- |
| **Dev Luker（8003）** | **可用（实测）** | 实例装有 `plugins/authority`（服务端插件）、`public/scripts/extensions/third-party/st-authority-sdk`（注入 `window.STAuthority`）；适配层 `initAuthorityAdapter` 实测达 `ready`，Trivium/SQL 数据面往返全通。Host Bridge 与此无关（L0-12 禁用路径）。 |
| Dev ST（8001） | 未验证（实例未运行） | Authority 的主宿主，理论可用，待实机复核后填表。 |

**部署形态事实**：实例的 Timelines 扩展目录是指向本工作仓的 NTFS junction
（`Instance/Dev/Luker/public/scripts/extensions/third-party/SillyTavern-Timelines → Myfork/SillyTavern-Timelines`），
代码改动即生效（刷新页面），**部署零动作**且天然满足 L0-1（无任何文件复制）。

### 4.2 Luker 宿主的 embedding 通道缺口（Phase 2 的实证依据）

Luker fork 的服务端**已移除 ST 上游的 embeddings 端点**：`src/endpoints/` 下无 `embeddings.js`，
`POST /api/embeddings/compute` 实测 404；`/api/vectors` 仅暴露 query/insert/rerank 等业务路由，
**无原始向量化端点**。因此「语义索引构建」在 Luker 上必然失败并走设计好的降级
（toast `构建失败: embedding 端点返回 404`、Authority 保持 `ready`、词法检索不受影响——已实测）。
解锁路径 = Phase 2（`http.fetch` 服务端 embedding 代理）或宿主侧恢复端点。

### 4.3 Trivium 运行时实测语义（对齐矩阵之外的"形状陷阱"）

0. **`http.fetch` 的授权模型与环回封锁**：请求 `{url, method, headers, body, bodyEncoding:'utf8'}`
   → 响应 `{status, ok, headers, body, bodyEncoding, contentType}`（body 为字符串）。
   **环回/实例自身地址被平台 SSRF 规则硬封锁**（`ensurePermission` 直接 reject）；其余 hostname 走
   「管理员策略 > 用户 grant > 系统默认 granted」决策链——本 Dev 实例的管理员策略当前封锁全部出网，
   放行为管理员操作。授权拒绝以 `AuthorityPermissionError` 抛出，调用方必须捕获并降级
   （Timelines 侧包装为 `EmbeddingUnavailableError` 熔断，见 `src/authority-http-fetch.js`）。
1. **`bulkDelete` 条目必须携带 `namespace`**：删除按 `(namespace, externalId)` 解析内部映射，
   缺省落在 `default` 命名空间 → 报 `"externalId default:<id> is not mapped"` 且 **successCount=0 静默漏删**
   （曾致生产增量清理从未真正删除过节点，2026-09-25 修复 + 回归单测）。按内部 `id` 删除不受此限。
2. **`payloadFilter` 仅支持标量等值**：`{namespace}` / `{bookmark:true}` 精确过滤可用；
   数组字段（`tags`）任何形态（`['x']` / `'x'` / `{$in}`）都不匹配，`{$has}` 直接报
   `unsupported trivium filter operator` → 标签类筛选只能客户端后过滤（`filterHitsByPayload`），
   并按 `SEMANTIC_POSTFILTER_TOPK_BOOST` 放大 topK 保召回。
3. **`stat({database})` 只计已持久化节点**：bulkUpsert 后未 `flush` 时 nodeCount 可能为 0；
   删除后 stat 也可含未压实墓碑——**以 searchHybrid 复查为准**，不要用 stat 断言增量结果。
4. **`trivium.neighbors`**：请求 `{database, id, depth}`（**要内部数字 id**，searchHybrid hits 自带 `id`
   可衔接）；响应 `{ids, nodes?: TriviumResolvedNodeReference[]}`，节点仅 `{id, externalId, namespace}`
   **不含 payload**——上下文预览文本需客户端另行解析。
5. **无 `trivium.neighbors` 特性旗标**：feature-flags 只有 `trivium.resolveId/resolveMany/tql/...`；
   neighbors 可用性检测用「方法存在性 + try/catch 降级」（`fetchNeighborsForHits` 即此实现）。

### 4.4 前端接线事实（E2E 依赖）

- `#tl_semantic_enabled` 有**两个事件绑定**：`input`（通用绑定器 → `settings.semanticSearchEnabled` 持久化）
  与 `change`（`setAuthorityFeatureEnabled` + `initAuthorityAdapter`）；自动化必须两者都触发。
- `/api/settings/get` 响应为旧式结构（扩展设置在 `settings.extension_settings` 下，非顶层）。
- 本实例（Dev Luker）的扩展设置**服务器持久化链路不落地**（`/api/settings/get` 中无 `timeline`/
  `SillyTavern-Timelines` 键，显式调用宿主 `saveSettingsDebounced()` 亦然）——环境基线，设置仅会话内生效。

---

