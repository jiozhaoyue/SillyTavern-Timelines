# PRD：Authority 服务端集成——语义检索索引与跨会话搜索

## Goal

通过可选接入 ST-Delegation-of-authority 服务端插件，为 Timelines 增加前端无法实现的能力：持久化向量语义索引（Trivium）、跨会话全局语义搜索、后台备份任务；保持零私有数据库哲学——原生 message.extra 仍为唯一数据源，服务端仅存可重建的派生索引。

## 背景与动机

当前智能全景雷达（`src/search-service.js` + `src/search-radar.js`）只能在**当前已构建的内存图谱**上做词法/正则检索。当角色拥有几十个分支会话、数千楼层时：

1. **搜不到**：未打开的分支会话不在内存图谱里，词法检索天然盲区。
2. **搜不准**：纯正则/分词无法表达"语义相近"（同义改写、代词回指）。
3. **不持久**：前端没有任何服务端索引，每次打开都要全量重扫。

Authority 提供按用户+扩展隔离的 Trivium 向量图数据库与混合检索（向量 + BM25），这是前端独立无法实现的能力，且其"能力嗅探 + 可选接入"模式与本插件微内核零耦合哲学一致。

## 核心原则（不可妥协）

1. **零私有数据源**：原生 `message.extra` / `chat.jsonl` 仍是唯一事实来源。Authority 中只保存**可随时全量重建的派生索引**（向量 + 增量状态表）。卸载 Authority 或清空其数据库，Timelines 所有功能完好，仅语义搜索降级关闭。
2. **零硬依赖**：不安装 Authority 时，插件行为与现状 100% 一致，无新增 console error、无 UI 空壳。
3. **最小权限声明**：仅声明 `trivium.private`、`sql.private`、`storage.kv`、`jobs.background`；绝不声明 `agent.*` / `fs.*` / `http.*`。
4. **主链路隔离**：索引构建、embedding 请求全部异步后台化，失败只影响语义搜索自身，绝不阻塞图谱渲染/分支操作。

## Requirements

### F1 Authority 适配器与状态管理
- 能力嗅探 `window.STAuthority?.AuthoritySDK`，SDK `init()` 幂等单例。
- 状态机：`absent → connecting → ready / error / disabled`；状态在设置面板可见（含授权引导提示）。

### F2 语义索引服务
- 将当前角色**所有分支会话**的消息节点写入 Trivium：`externalId = <chatFile>::<messageId>`，payload 含 chatFile、messageId、说话人、楼层、标签、书签、文本预览。
- 父子楼层图边（`label: 'next'`）经 `bulkLink` 写入，支撑 `expandDepth` 上下文扩展。
- **增量构建**：SQL 私有库 `index_state` 表记录 `(chat_file, message_id, content_hash)`；未变节点跳过；变更/新增重写；消失节点删除。
- 每个写入节点调用 `indexText`（供 BM25 通道）；按需 `createIndex('chatFile')` 属性索引。
- 分批异步构建（批大小可配），提供进度回调与"构建/重建索引"按钮；完成可选 `trivium.flush`。

### F3 Embedding 提供方
- 可插拔：默认 ST 原生 `POST /api/embeddings/compute`（`getRequestHeaders()` 鉴权），端点可配置。
- 串行批请求 + 文本哈希内存缓存。
- 维度变化自动切库（`tl_vec_<dim>`），旧库保留并在 UI 提示。
- 失败降级：连续失败 N 次置 `error`，UI 提示，词法雷达不受影响。

### F4 语义搜索 UI 集成
- 雷达新增"语义"模式（仅 Authority ready 且索引库有数据时可用）：
  - **当前图谱语义重排**：hits 按 externalId 映射回内存节点，复用雷达高亮/步进/调光交互。
  - **跨会话全局语义搜索**：直接展示 hits payload（chatFile/messageId/文本预览），每条提供"穿越"（`openCharacterChat` + 楼层定位，复用快照时光机跳转逻辑）。
- 词法模式行为完全不变。

### F5 设置项
- 总开关（默认关闭）`semantic_search_enabled`；embedding 端点与批大小配置。
- "构建索引 / 重建索引 / 索引状态"入口（节点数、边数、上次构建时间、最近错误）。
- 全部存 `extensionSettings.timelines`（沿用 `saveSettingsDebounced`）。

## 非目标（本期不做）

- Authority Agent Runtime 集成、跨用户广播。
- 聊天文件备份进 Authority Blob（与零私有数据源原则有张力，另行评估）。
- embedding 的 SQL 持久缓存（内存缓存即可，向量本就在 Trivium）。
- 现有词法/正则检索的任何行为改动。

## Acceptance Criteria

- [ ] 无 Authority 环境：加载插件无报错，雷达无语义入口，测试全绿。
- [ ] 有 Authority 环境：授权后可构建索引；`trivium.stat` 节点/边数与消息数一致；重复构建为增量（内容未变节点零写入）。
- [ ] 语义模式：中文同义改写查询能召回词法搜不到的节点；"穿越"跳到正确会话与楼层。
- [ ] `node --test tests/*.test.mjs` 全绿；新增纯逻辑模块（externalId 编解码、payload 映射、增量 diff、embedding 批处理、状态机）有单元测试。
- [ ] 断网/授权拒绝/维度切换三种异常路径：主图谱功能零影响，UI 有明确降级提示。
