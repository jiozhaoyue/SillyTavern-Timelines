# L4 timeline 下一轮增强

## Goal

与后端插件 ST-Delegation-of-authority（Authority，jiozhaoyue fork）的结合质量保障与收敛：
对照 Authority 仓真实 API 面逐字段核验 Timelines 适配层契约，修正违反最小权限铁律（L1-MF-5）
的多余权限声明，并把已验证的 API 对齐矩阵沉淀为 spec，供宿主升级后快速重对。

## Background（证据）

- 用户裁定（2026-09-25 会话）：本轮范围 = 「怎么和后端插件结合（使用 jiozhaoyue fork）」。
- Session 14 完成语义集成时未做 E2E 实机验证，适配层与 Authority 真实 API 面的一致性此前无核验记录。
- Authority 仓位于 `D:\Repo\Tavern-repo\Myfork\ST-Delegation-of-authority`（fca5329），
  契约真源在 `packages/shared-types/src/{session,permissions,trivium,sql,common}.ts` 与
  `packages/sdk-extension/src/{index,sdk,client}.ts`。
- Timelines 侧实际调用面（grep 证据）：仅 `client.trivium.*`（bulkUpsert/bulkDelete/bulkLink/
  searchHybrid/indexText/createIndex/flush/stat）与 `client.sql.*`（migrate/query/batch/exec），
  从未调用 `jobs.*` 与 `storage.kv`，但适配器声明了这两项权限（违反 L1-MF-5）。

## Requirements

1. **API 对齐核验**：适配器 `initAuthorityAdapter` 的 init 配置（extensionId 模式 / installType /
   declaredPermissions 形状）与全部 12 个 client 方法调用的请求/响应 DTO 字段，逐一对照
   Authority 仓 shared-types 核验；差异必须修复或书面说明。
2. **最小权限修正**：`AUTHORITY_DECLARED_PERMISSIONS` 移除未使用的 `storage.kv` 与
   `jobs.background` 声明，仅保留 `trivium.private` 与 `sql.private`；测试补对应负断言。
3. **知识沉淀**：验证过的 API 对齐矩阵写入 `.trellis/spec/frontend/optional-integration.md`
   （自包含、含 Authority 侧 file:line 证据），并修正该 spec 中已过时的权限清单描述。
4. **零行为回归**：未安装 Authority 时主链路零影响；124 项单测保持全绿。

## Acceptance Criteria

- [x] 全部 init 配置字段与 12 个 client 方法调用与 Authority 仓 DTO 核验一致（矩阵见 spec §3）
- [x] `AUTHORITY_DECLARED_PERMISSIONS` 仅含 `trivium`/`sql` 两项；测试断言 `storage`/`jobs` 不在声明中
- [x] spec §1.3 权限描述同步修正；§3 新增对齐矩阵（含 file:line 证据）
- [x] `node --test tests/*.test.mjs` 全量通过（124/124）
- [x] 改动提交并推送 origin

## Open Questions（已裁定）

1. ~~本轮范围~~ → 用户裁定：与后端插件（Authority，jiozhaoyue fork）结合的对齐审计与修正。
2. ~~复杂度定位~~ → 轻量任务（PRD-only）：审计 + 单点修正，无架构变更。
3. 原 PRD 候选 1（雷达语义空结果提示）经核查**已存在**（`search-radar.js` 0/0 徽章 + 🌐 跨会话
   徽章 + toast 提示三态俱全），关闭该候选；候选 2（边标签）评估为低价值维持关闭；候选 3
  （多树视图）为大特性，另立任务。

## Notes

- 约束遵循：L0-12（跨宿主插件仅用 Authority 可移植子集，禁 Host Bridge——适配层只经
  `window.STAuthority.AuthoritySDK` 公开 API，未触碰 `STAuthorityHostBridge`）；L1-MF-4
  （Authority 侧数据全部为可重建派生投影）；L1-MF-5（本任务修正对象）。
