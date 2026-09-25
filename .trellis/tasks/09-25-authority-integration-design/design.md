# Timelines × Authority 后端插件集成考虑（完整设计）

> 任务：`09-25-authority-integration-design` ｜ 日期：2026-09-25 ｜ 分支：`codex-luker-chinese-refactor`
> 结论先行：**继续沿用「可移植子集 + 适配器降级」路线，推荐 Phase 0（实机 E2E）→ Phase 1（零新权限的检索深化）**；http.fetch / storage.blob 两项可选增强按需后置；agent.*、modules、Host Bridge、事实源违规四类永久不做。

---

## 0. 背景与范围

- Session 14 已落地 Authority 语义索引与跨会话检索；Session 19 完成与 Authority 仓（jiozhaoyue fork，基准 `fca5329`）API 面的逐字段对齐审计（结果：全一致）与最小权限修正。
- 本文档补全「怎么和后端插件结合」的**完整考虑**：能力面全景（§2）→ 候选方向（§4）→ 边界红线（§5）→ 分期路线（§6）。
- 本任务为纯设计任务，不改动产品代码；用户裁定某一期后再立实施任务。

---

## 1. 现状盘点（已落地面）

### 1.1 集成架构（Timelines 侧）

| 模块 | 职责 | 关键事实（file:line） |
| --- | --- | --- |
| `src/adapters/authority-adapter.js` | 状态机 + 嗅探 + 客户端单例 | 五态 `absent/disabled/connecting/ready/error`，非法转移静默忽略（L52-94）；嗅探 `window.STAuthority?.AuthoritySDK`（L121-126）；幂等 init + 失败 60s 冷却（L15、L136-138）；声明权限 `{trivium:{private:true}, sql:{private:true}}`（L30-33）；`extensionId = third-party/sillytavern-timelines`（L18） |
| `src/semantic-index-service.js` | 语义索引构建（派生投影写入） | `externalId = <chatFile>::<messageId>`（L32-51）；枚举基于节点 `chat_sessions`（L156-180）；FNV-1a 内容指纹增量 diff（L192-237）；楼层 `next` 边合成（L245-269）；库名 `tl_vec_<dim>` 按维度切库（L326-329）；`index_state` 状态表（L271-285） |
| `src/semantic-search-service.js` | 语义检索执行与映射 | `searchHybrid`（向量+BM25，α=0.5，topK=30，`payloadFilter` 按 namespace）（L115-146）；hits→当前图节点映射（L30-70）；跨会话结果行格式化（L78-100） |
| `src/embedding-provider.js` | 向量化提供方 | 走宿主端点 `/api/embeddings/compute`（L95-99）；文本哈希缓存（L136-142）；连续 3 批失败熔断（L15、L155-162） |
| `src/semantic-global-modal.js` | 跨会话结果弹窗 | 结果行 + `openCharacterChat` 穿越 |

接线：`index.js:125` 启动时 `initAuthorityAdapter()`；设置默认值 `semanticSearchEnabled:false`（`index.js:158-160`）；设置面板启用开关 / 端点 / 批量 / 状态 / **构建与重建按钮**（`index.js:2515-2608`）。

### 1.2 数据流（索引构建，`semantic-index-service.js:339-507`）

```
枚举图谱节点(chat_sessions) → 解析截断节点全文 → sql.migrate(index_state)
→ 读状态表 → 试向量化探维度(tl_vec_<dim>) → 指纹 diff（upserts/deletes/staleOtherDb）
→ trivium.bulkDelete（清理）→ provider.embed（全文向量）
→ trivium.bulkUpsert + indexText(BM25 文本通道) → sql.batch 登记 index_state
→ trivium.bulkLink(next 楼层边) → createIndex(namespace/chatFile) → flush（尽力而为）
```

### 1.3 已知局限（候选方向的依据）

1. **索引构建纯手动**：仅设置面板两个按钮触发（`index.js:2607-2608`），聊天推进后索引静默过期，需手动重建。
2. **embedding 依赖宿主端点**：维度绑定宿主当前 embedding 源；浏览器直连第三方 embedding API 则有 CORS 与密钥暴露问题。
3. **检索范围默认限当前角色**：`payloadFilter` 按 namespace（char_N/group_N）过滤；跨角色检索无入口。
4. **Trivium 能力未用尽**：payload 已含 `tags/bookmark/is_user/depth`（`buildNodePayload`，`semantic-index-service.js:116-132`）但雷达语义模式未暴露这些筛选；已建楼层 `next` 边但未使用 `neighbors` 图查询。

---

## 2. Authority 公开能力面全景（SDK client 实测方法面）

> 核验基准：Authority 仓 `packages/sdk-extension/src/client.ts`（jiozhaoyue fork）与 `docs/server/capabilities-and-isolation.md`（下称「能力文档」）。风险等级引自能力文档 §2。

### 2.1 权限资源面（8 项）

| 能力 | SDK 入口（client.ts） | 风险级 | 隔离维度 | Timelines 现状 |
| --- | --- | --- | --- | --- |
| `storage.kv` | `client.storage.kv.{get,set,delete,list}`（L726-756） | low（默认 granted） | 用户 + 扩展（每扩展一个 sqlite，能力文档 §7.1） | 未用 |
| `storage.blob` | `client.storage.blob.{put,...}`（L757+，大对象走 transfers） | low | 用户 + 扩展 + blobDir（§7.2） | 未用 |
| `fs.private` | `client.fs.*`（L799+，虚拟路径沙盒，symlink 禁止，越界拒绝） | medium | 用户 + 扩展私有 root（§7.3、§8） | 未用 |
| `sql.private` | `client.sql.{migrate,query,batch,exec}` | medium | 用户 + 扩展 + 数据库名（§7.4） | **已用**：`index_state` 状态表（库 `main`） |
| `trivium.private` | `client.trivium.{bulkUpsert,bulkDelete,bulkLink,searchHybrid,indexText,createIndex,flush,stat}`；另有 `neighbors`、`query`、`filter`、advanced search、unlink（能力文档 §9） | high | 用户 + 扩展 + `.tdb` 库名（§7.5） | **已用**：前 8 个方法；`neighbors/query/filter` 未用 |
| `http.fetch` | `client.http.fetch(input)`（L1585-1596），target=**hostname** | medium | 用户 + 扩展 + hostname（§7.6） | 未用 |
| `jobs.background` | `client.jobs.create(type,payload,options)`（L1657+）；**内置仅 4 型**：`delay` / `sql.backup` / `trivium.flush` / `fs.import-jsonl`（§7.7） | medium | 用户 + 扩展 + job.type | 未用 |
| `events.stream` | `client.events.{subscribe,recordCommit,getEvent,getConversation,listEvents}`（L1793+）；channel 默认 `extension:<extensionId>`，eventNames 默认 `['authority.connected','authority.job']`；DB-backed 轮询桥 SSE + 自动重连（§7.8、§11） | low | 用户 + 扩展 + channel | 未用 |

### 2.2 非资源面

| 面 | SDK 入口 | 说明 |
| --- | --- | --- |
| `transfers/*` | `client.transfers.{init,status,manifest,append,read,discard}`（L1597-1655） | 大对象运输层，**不是新权限资源**（能力文档 §7.9）；blob / fs.private / http.fetch 的大结果经此走分块 |
| `permissions` | `client.permissions.{evaluate,evaluateBatch,explain}` | 权限自检/解释，可用于设置面板的「能力可用性」诊断展示 |
| `probe / hasFeature / requireFeature` | `client.ts:2395-2462` | **特性检测入口**：新方法调用前按特性路径门禁（L0-12「显式标注宿主可用性」的机制支撑） |
| `modules/*` | `client.ts:1907+` | 宿主模块事务管理面，与 Timelines 无关，**不碰** |
| `agent/*` | `client.ts:2003+` | agent 平台（会话/浏览器工具/LLM profile），**不碰**（L1-MF-5） |

### 2.3 宿主可用性（L0-12 要求显式标注）

- Authority = **服务端插件**（Node adapter，`/api/plugins/authority/...`）+ **前端 SDK**（`window.STAuthority = { AuthoritySDK, openSecurityCenter }`，`sdk-extension/src/index.ts:7`）。可用性判定 = **该宿主后端是否安装并启用 authority server-plugin**。
- **SillyTavern（Dev 8001）**：Authority 的主宿主，可安装——待实机 E2E 实证。
- **Luker（Dev 8003）**：**待实证**（Session 19 遗留项）。注意区分：L0-12 实测被拒的是 **Host Bridge**（宿主补丁路径，按宿主版本门禁）；Timelines 走的是**可移植子集**（SDK + server plugin），路径独立于 Host Bridge，理论可用但必须实测后才能标注「可用」。
- 客户端判定机制已就位：适配层嗅探失败 → `absent` 静默休眠（`authority-adapter.js:129-133`）；版本/特性级判定可用 `probe/hasFeature`。
- E2E 纪律：L1-MF-15 启动断言（端口白名单 `{8001, 8003, 8899}`、`BASE_URL` 无默认值、禁止读取实例聊天内容）。

---

## 3. 设计原则（沿用既有范式，不新增）

1. **可移植子集唯一入口**（L0-12）：只用 §2.1 公开适配层 API，禁 Host Bridge。
2. **适配器 + 特性检测 + 静默降级**（L0-11）：新能力全部挂在现有五态状态机之后，`absent` 短路零影响；新 Trivium 方法（如 `neighbors`）加 `hasFeature` 门禁。
3. **派生数据唯一原则**（L1-MF-4）：Authority 中只允许存「可从原生 `message.extra`/`chat.jsonl` 全量重建的投影」；卸载 Authority 后 Timelines 全功能完好。
4. **最小权限**（L1-MF-5）：每新增一个资源，设置面板须向用户说明用途；权限增量在本文档逐期标明。
5. **六禁区**（L1-MF-9，源自 Authority 仓 `docs/server/ai-integration-guide.md` §6）：浏览器不直连 core、不绕 PermissionService、不手写数据文件路径、不自当 embedding 服务、不把 jobs 当任意执行平台、mapping integrity 不进热路径。

---

## 4. 候选集成方向

### 方向 A：Trivium / SQL 深化（零新权限）★ 推荐

| 子项 | 做什么 | 价值 | 权限增量 | 数据边界 | 风险/代价 |
| --- | --- | --- | --- | --- | --- |
| A1 语义上下文扩展 | 对语义命中的节点调用 `trivium.neighbors`（沿已建 `next` 楼层边走 1 跳），在雷达结果中附「前后楼层上下文」 | 检索结果从孤立楼层变成可读片段；利用已建图边零成本 | 0 | 纯读取派生索引 | 低；需 `hasFeature` 门禁；不进主线程渲染热路径（L1-MF-11） |
| A2 雷达语义筛选接线 | `payloadFilter` 扩展 tags/bookmark 筛选（payload 字段已存在，`semantic-index-service.js:116-132`；`semantic-search-service.js:134` 已支持 filter 通道），接入雷达筛选面板 | 语义+属性复合检索一步到位 | 0 | 纯读取 | 低；纯前端接线 |
| A3 跨角色全局检索 | 「跨角色」开关：`payloadFilter` 置空 → 命中所有 namespace；跨会话弹窗（`formatGlobalResults`）增加 namespace 来源标注与按角色分组 | 把「单角色语义检索」升级为「全库剧情检索」 | 0 | 同扩展同用户的私有库内部，合规 | 中；payload 现无角色显示名（namespace 是 `char_N` 键），需 payload 增补 `namespaceLabel` 字段（增量索引自动补齐，老条目重建前显示键名） |
| A4 自动增量索引（默认关） | 聊天变更事件后 debounce 触发增量 build（diff 后通常只有个位数条目需 embed） | 索引不再静默过期 | 0 | 派生投影，重建安全 | 中：后台网络/能耗、错误风暴——必须复用 60s 冷却 + 设置默认关 + 失败不 toast 轰炸 |
| D1 跨角色统计物化 | `index_state` 已按 namespace 记账（`getSemanticIndexStatus`，`semantic-index-service.js:565-568`），扩展为跨 namespace 聚合查询 → 全景数据看板「全库聚合模式」 | 看板从单角色升级为全库视角 | 0 | 全部来自派生状态表 | 低 |

### 方向 B：`http.fetch` 服务端 embedding 代理（+1 权限）

- **做什么**：`embedding-provider.js` 增加 transport 分支——经 `client.http.fetch` 在服务端出网调 embedding API；宿主端点 `/api/embeddings/compute` 保持默认，二者可切换。
- **价值**：绕过浏览器 CORS；出网按 hostname 治理并进审计；第三方 embedding 不再受宿主当前连接的 embedding 源限制。
- **如实说明边界**：`http.fetch` **不提供密钥保管**——请求头仍由扩展侧组装传入（`client.ts:1585-1596` 仅按 hostname 做权限与代理）。价值是「无 CORS + 治理 + 审计」，不是密钥保险箱。
- **权限增量**：`http.fetch`（medium，授权弹窗按 hostname 出现）。
- **数据边界**：向量是派生数据，合规。
- **风险/代价**：provider 双通道增加测试面（保持 `fetchImpl` 注入，Node 可测）；用户需理解「为什么多了一个授权项」。

### 方向 C：服务端留存（`storage.blob` / `fs.private`，+1~2 权限）

- **C1 导出历史画廊**：超大画幅 PNG / SVG / GFM 导出（`export-service.js`）后可选存服务端（blob 优先，大对象走 transfers），形成「导出历史」入口。
  - 数据边界：导出物可从图谱随时重建，属派生物，合规 L1-MF-4。
  - 权限增量：`storage.blob`（low）即可满足；**不引入 `fs.private`**（medium 且无超出 blob 的必要）。
- **C2 设置跨设备镜像**：kv 镜像设置——只能做「只读镜像/恢复源」，宿主 localStorage 仍为事实源（设置是用户输入而非派生数据，做事实源即违规 L1-MF-4）。价值有限，**默认不做**，待用户明确提出多设备需求。

### 方向 D：jobs / events（当前无必要）

- `events.stream`（low）：订阅 `extension:third-party/sillytavern-timelines` 收 `authority.job` 完成事件——仅当出现「后台任务化」需求（如 A4 改后台执行）才有价值；当前 jobs 调用均可同步等待结果。**不独立启用，跟随 A4/B 的实际需要**。
- `jobs.background`（medium）：可用场景只有 `trivium.flush` 离手刷盘与 `sql.backup`（`index_state` 本就可重建，备份价值≈0）。**当前不启用**。

### 方向 E：不做清单（红线，永久）

1. `agent.*` —— L1-MF-5 高危权限禁止顺手声明；Timelines 无 agent 场景。
2. `modules/*` —— 宿主模块事务管理面，与 Timelines 无关。
3. **Host Bridge** —— L0-12 硬禁（跨宿主插件）。
4. **任何以 Authority 为事实源的数据** —— L1-MF-4（标签/书签已存原生 `message.extra`，`src/tag-manager.js`）。
5. `checkMappingsIntegrity` / `deleteOrphanMappings` / `stat(includeMappingIntegrity)` 进业务热路径 —— L1-MF-9⑥。
6. 把 jobs 当任意代码执行平台 —— L1-MF-9⑤（仅 4 内置型）。
7. 把 Trivium 当 embedding 服务 —— L1-MF-9④（向量必须由 Timelines 侧 `embedding-provider` 提供）。

---

## 5. 分期路线（推荐裁定）

| 期 | 范围 | 权限增量 | 验证方式 | 前置 |
| --- | --- | --- | --- | --- |
| **Phase 0（先行）** | 实机 E2E：Dev Luker 8003 + Authority server plugin——语义索引构建 → `searchHybrid` → 跨会话穿越全链路 + 适配层五态行为与降级路径 | 0 | L1-MF-15 断言的自动化脚本 + CDP 截图留证 | Session 19 遗留项；宿主可用性实证结论回填 spec `optional-integration.md` |
| **Phase 1（推荐实施）** | A2 + A3 + D1 + A1（全部零新权限，按此序交付：接线类先行、`neighbors` 殿后） | 0 | 单测（纯函数注入）+ CDP 实机；`node --test tests/*.test.mjs` 全绿（L0-13） | Phase 0 通过 |
| **Phase 2（可选）** | B：http.fetch embedding 代理 | +`http.fetch` | 单测 + 实机双通道切换 | **用户确认 embedding 工作流确有 CORS/维度痛点** |
| **Phase 3（可选）** | C1：导出服务端留存画廊 | +`storage.blob` | 单测 + 实机 | 用户有留档需求 |
| 独立小任务 | A4 自动增量索引（默认关） | 0 | 单测 + 实机（含 60s 冷却行为） | 用户裁定需要 |
| 不排期 | C2、方向 D、方向 E 全部 | — | — | — |

**推荐理由**：Phase 1 权限面零增长（用户授权弹窗零新增）、全部建立在已审计对齐的 API 面上（spec `optional-integration.md` §3 矩阵）、每项都直接增强既有功能入口（雷达 / 跨会话弹窗 / 数据看板），是风险最低、价值最直接的一档；Phase 2/3 各引入一个新授权项，应以用户真实需求为准，不预先铺权限。

---

## 6. 开放问题（需用户裁定）

1. 分期路线是否认可（Phase 0 → Phase 1 先行）？
2. A3 跨角色全局检索的**默认范围**：默认当前角色（保守）还是默认全库（激进）？
3. A4 自动增量索引是否需要？默认关是否符合预期？
4. Phase 2（http.fetch embedding 代理）是否存在真实需求（取决于用户的 embedding 使用方式）？

---

## 7. 通用工程约束（适用所有期，实施任务回填时复检）

- 降级：L0-11 适配器范式；新能力 `absent` 短路，失败只降级自身并 toast，不波及词法检索。
- 可测：spec `optional-integration.md` §2 Node 可测约定（纯函数 + 依赖注入，禁静态导入宿主模块）。
- 性能：L1-MF-11（图算法纯函数、Worker、无动态样式闭包）；服务端查询一律异步，不阻塞渐进式渲染管线。
- 确定性：内容指纹用 FNV-1a `hashText`，不用时间戳（L1-MF-13）。
- 测试门：`node --test tests/*.test.mjs` 全绿再交付（L0-13）；E2E 只对 Dev 实例（L1-MF-15）。
