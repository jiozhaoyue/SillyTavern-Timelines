# 执行清单（implement.md）

> 复选框随执行实时勾选（L0-2），禁止事后补勾。

## Phase 0：实机 E2E

- [x] 1.1 E2E 脚本骨架 `tests/e2e/phase0-authority.mjs`：L1-MF-15 启动断言（BASE_URL 无默认、端口白名单、误连即非 0 退出）
- [x] 1.2 登录 8003 → 适配层 ready 断言（st-authority-sdk 注入验证；实例无登录拦截，CDP 直连即可）
- [x] 1.3 ~~语义索引构建 → stat/index_state 增长断言~~ **偏差**：Luker fork 已移除 `/api/embeddings/compute`（`src/endpoints/` 无 embeddings 路由，实测 404），宿主侧无任何原始向量化端点 → 构建链路在该宿主无法走通 embedding 通道；改为「优雅降级断言」通过（toast `语义索引构建失败: embedding 端点返回 404`、Authority 保持 ready、词法检索不受影响）。此发现坐实 Phase 2（embedding 服务端代理）优先级
- [x] 1.4 ~~searchHybrid 命中 + 雷达截图~~ 等价验证：Trivium 数据面往返探针（合成向量 bulkUpsert→searchHybrid score 1.13→bulkDelete→复查消失，8/8 全绿）；雷达语义模式 UI 留待 Phase 1 实机复验
- [x] 1.5 跨会话弹窗与穿越断言 + 截图（formatGlobalResults + openSemanticGlobalModal 合成行渲染通过；穿越按钮为原生 openCharacterChat 既有链路）
- [x] 1.6 降级路径验证（并入 1.3：embedding 404 → 熔断 → Authority ready 保持、词法检索不受影响）
- [x] 1.7 payloadFilter 行为实测结论：**等值过滤可用**（`{namespace}` / `{bookmark:true}` 精确过滤）；**数组字段不匹配**（`tags:['x']`/`'x'`/`{$in}` 均空结果，`{$has}` 报 unsupported）→ A2 标签筛选降级为客户端后过滤（topK ×3 保召回），bookmark/namespace 走服务端过滤
- [x] 1.8 宿主可用性结论回填 spec `optional-integration.md`（见任务收口提交）

**Phase 0 附带生产级修复**：`semantic-index-service.js` 两处 `bulkDelete` 条目缺 `namespace`——Authority 按 `(namespace, externalId)` 解析映射，缺省落 `default` 报 "not mapped" **静默漏删**（增量清理从未真正删除过 Trivium 节点）；已修复 + 回归单测（semantic-index.test.mjs 9/9 绿）+ E2E 探针实证（gone=true, statAfter=0）。E2E 另确认 `#tl_semantic_enabled` 双事件绑定事实（`input` 持久化设置 / `change` 初始化适配器）。

## Phase 1：四件套（零新权限）

- [x] 2.1 A2 纯函数 `buildSemanticPayloadFilter` + 单测（含「tags 不入服务端 filter」实测依据）
- [x] 2.2 A2 雷达 UI 接线：语义模式复用现有筛选面板——书签走服务端 payloadFilter；标签（chk-tagged）/说话人走 `filterHitsByPayload` 客户端后过滤（topK ×3 保召回）
- [x] 2.3 A3 索引端 payload 增补 `namespaceLabel`（SemanticIndexer 注入参数；未传时不写该字段）+ index.js `makeSemanticNamespaceLabel`
- [x] 2.4 A3 检索端 `scope` 参数（global 不加 namespace 过滤）+ 设置项 `semanticGlobalScope`（默认关）+ 分组纯函数 `groupGlobalResultsByNamespace` + 单测
- [x] 2.5 A3 弹窗来源徽标（`namespaceLabel ?? namespace`）与分组渲染（`groupByNamespace` context）+ CSS
- [x] 2.6 D1 `aggregateIndexStateByNamespace` 纯函数 + `getGlobalIndexStats` IO + 单测
- [x] 2.7 D1 看板「全库语义索引聚合」区块（ready 才渲染，失败/无数据静默移除 + `:empty` 兜底）+ CSS
- [x] 2.8 A1 `expandHitWithContexts` 纯函数 + `fetchNeighborsForHits` IO（topN 5 / depth 1 / 方法存在性检测 / try-catch 降级）+ 单测。**偏差**：neighbors 响应仅含 `{id, externalId, namespace}`（无 payload），上下文落定为「相邻楼层身份芯片 + 点击穿越」，preview 文本需缓存管线列为后续项
- [x] 2.9 A1 雷达语义模式跨会话结果卡「↳ 相邻楼层」芯片（点击走 navigateToMessage 原生调度）
- [x] 2.10 权限负断言保持通过（AUTHORITY_DECLARED_PERMISSIONS 不变，全量 134/134 绿）

## 质量门与部署

- [x] 3.1 `node --test tests/*.test.mjs` 全量绿：**134/134**（基线 124 + Phase 1 新增 10）
- [x] 3.2 `node --check` 全部改动文件（index.js / 5 个 src 模块 / E2E 脚本）
- [x] 3.3 ~~push origin → git pull 部署~~ **部署零动作**：实例扩展目录是指向本工作仓的 NTFS junction（`Instance/Dev/Luker/public/scripts/extensions/third-party/SillyTavern-Timelines → Myfork/SillyTavern-Timelines`，2026-09-04 建立），改动即生效；推送仅承担 L0-7 持久化义务
- [x] 3.4 实机复验：Phase 0 E2E 重跑 8/8 全绿（零回归）；Phase 1 冒烟通过——雷达五组控件/语义按钮/全局徽章/新开关全部在位（截图 `phase1_radar_filters.png`）；D1 `getGlobalIndexStats` 真实 client 返回 ok:true；A1 neighbors 方法存在 + 空命中降级为空 Map
- [x] 3.5 WIKI/README 同步四件套说明
- [x] 3.6 提交推送 + 会话记录 + 任务归档

## 冒烟发现的环境事实（非回归，记录备查）

1. **实例扩展设置服务器持久化链路不落地**：`/api/settings/get` 的 `settings.extension_settings` 中既无 `timeline` 也无 `SillyTavern-Timelines` 键（连既有 `semanticSearchEnabled` 也 missing），显式调用宿主 `saveSettingsDebounced()` 后仍无——实例基线行为，非本次改动引入；会话内内存设置正常（构建按钮 early-return 检查实际通过）。
2. `#tl_semantic_enabled` 双事件绑定：`input`（通用绑定器持久化）/ `change`（适配器初始化 handler），E2E 须两者都触发。
3. `/api/settings/get` 响应为旧式结构（扩展设置在 `settings.extension_settings` 下）。
