# 执行计划：Authority 语义检索集成

> 前置：`prd.md`（需求）+ `design.md`（模块契约）+ `research/authority-sdk-api-summary.md`（SDK API 参考，实现时必须对照）。
> 硬约束：所有新代码 ES Module；不引入 npm 依赖与 vendor 文件；不 commit（主会话负责）。

## 阶段 A：纯逻辑模块 + 单元测试（先测后 IO）

- [x] A1 `src/embedding-provider.js`：`hashText` / `chunkTexts` / `createEmbeddingProvider`（fetchImpl 注入；连续 3 批失败抛 `EmbeddingUnavailableError`；内存缓存）
- [x] A2 `tests/embedding-provider.test.mjs`：分批边界、缓存命中不再 fetch、失败计数与熔断、dim 提取
- [x] A3 `src/semantic-index-service.js` 纯函数部分：`encodeExternalId` / `decodeExternalId` / `buildNodePayload`（preview 截断）/ `computeContentHash` / `diffIndexState`（增/改/删/未变 四路径 + 跨库）/ `buildFloorLinks`（同 chat 相邻、跨 chat 不连）
- [x] A4 `tests/semantic-index.test.mjs`：覆盖 A3 全部纯函数，含中文文本与空 tags 边界

## 阶段 B：适配器与 IO 编排

- [x] B1 `src/adapters/authority-adapter.js`：状态机（纯逻辑导出可测）+ `initAuthorityAdapter`（嗅探 `window.STAuthority?.AuthoritySDK`、`init` 配置按 research §2/§3、错误 60s 冷却）+ `getAuthorityClient` / `getAuthorityStatus` / `onAuthorityStatusChange`
- [x] B2 `tests/authority-adapter.test.mjs`：absent/disabled/connecting/ready/error 转移表、无 SDK 时静默
- [x] B3 `semantic-index-service.js` IO 部分：`SemanticIndexer` 类（build 分批流水线：diff → embed → bulkUpsert → indexText → bulkLink → SQL index_state 更新 → flush；onProgress 回调；cancel 在批间生效；`getStatus`）
- [x] B4 `src/semantic-search-service.js`：`mapHitsToNodes`（externalId→elements 匹配，含 `chat_sessions` 多键容错）/ `formatGlobalResults` / `semanticSearch`（查询向量化 + `searchHybrid`，参数对照 research §4）
- [x] B5 `tests/semantic-search.test.mjs`：hits 映射（命中/未命中/去重）、全局结果格式化、payloadFilter 组装

## 阶段 C：UI 接缝（最小侵入）

- [x] C1 `index.js`：启动序列 `initAuthorityAdapter()`（紧邻 `initMemoryGraphAdapter()`，index.js:115 附近）；设置读写扩展（`semantic_search_enabled` 默认 false、`semantic_endpoint`、`semantic_batch_size` 默认 8）
- [x] C2 `settings.html` + 绑定：新 inline-drawer「语义检索 (Authority)」——开关、endpoint 输入、批大小、构建/重建按钮、状态行（节点/边/最近构建/错误）
- [x] C3 `src/search-radar.js`：语义模式入口（仅 ready+有索引时注入按钮）；`executeSearch` 异步语义分支：`semanticSearch` → `mapHitsToNodes` → 复用现有 matches/step/dim；未映射 hits 计数徽章「N 条跨会话结果」打开全局弹窗；失败 toast + 回退词法
- [x] C4 新 `src/semantic-global-modal.js`：结果列表（chatFile/messageId/说话人/预览/score），「穿越」复用 `openCharacterChat` + `navigateToMessage`（参照 snapshot-modal.js:202-209）
- [x] C5 `style.css`：语义徽章、全局结果列表样式，沿用现有 CSS 变量与暗色系

## 阶段 D：验证与收尾

- [x] D1 `node --test tests/*.test.mjs` 全绿（既有 78+ 用例不得回归）
- [x] D2 语法自检：`node --check` 所有改动文件
- [ ] D3 人工验收清单输出（无 Authority 环境零影响 / 有 Authority 的手动步骤说明）

## 验证命令

```bash
node --test tests/*.test.mjs
node --check src/embedding-provider.js   # （及其他每个新/改文件）
```

## 回滚点

- 每阶段独立可回滚；阶段 C 之前 UI 零改动，回滚即删除新文件。
- 主图谱链路仅 index.js 两处 + search-radar.js 注入点有接触，均可独立 revert。
