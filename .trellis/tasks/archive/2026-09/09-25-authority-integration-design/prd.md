# Authority 后端插件集成考虑与分期路线

## Goal

补全 Timelines 与后端插件 ST-Delegation-of-authority（jiozhaoyue fork）结合的完整设计考虑：能力面全景、候选方向、边界红线与分期路线，供用户裁定后续实施范围

## Requirements

- **R1 能力面全景**：逐一盘点 Authority 公开适配层全部能力（`storage.kv` / `storage.blob` / `fs.private` / `sql.private` / `trivium.private` / `http.fetch` / `jobs.background` / `events.stream`，及非资源面 `transfers`、`permissions`、`probe/hasFeature`、`modules`、`agent`），给出 SDK 入口、风险等级、隔离维度与 Timelines 当前使用状态；事实以 Authority 仓源码与 `docs/server/capabilities-and-isolation.md` 为准。
- **R2 现状盘点**：盘点 Timelines 已落地的集成面（适配层状态机、语义索引、语义检索、embedding 提供方、设置面板接线），指出已知局限，作为候选方向的依据。
- **R3 候选方向评估**：每个候选方向必须给出：做什么、用户价值、消耗的能力与权限增量（对照 L1-MF-5）、数据边界合规性（对照 L1-MF-4「原生数据源唯一」）、风险与代价；并给出明确的不做清单（含 L0-12 / L1-MF-9 禁区）。
- **R4 分期路线**：给出可裁定的分期路线（每期：范围、权限增量、验证方式），并明确推荐顺序与理由。
- **R5 自包含**：文档自包含，所有关键结论带 file:line 证据，不依赖任务目录外的工作副本。

## Acceptance Criteria

- [x] R1：能力面全景表覆盖全部 8 个权限资源 + 非资源面，且与 Authority 仓 `client.ts` / `capabilities-and-isolation.md` 逐项对得上
- [x] R2：现状盘点覆盖 5 个已落地模块并引用真实路径，局限清单与代码现状一致（含「索引构建纯手动」这一关键事实）
- [x] R3：≥4 个候选方向 + 不做清单，每个方向含价值/权限增量/数据边界/风险四要素；不做清单覆盖 agent.*、modules、Host Bridge、事实源违规四类
- [x] R4：分期路线每期有明确权限增量与验证方式，Phase 0 为实机 E2E（Dev Luker 8003，Session 19 遗留项）
- [x] R5：design.md 自包含；全文中文
- [x] 本任务为纯设计任务，不改动产品代码（`git status --short` 中不出现 src/ 与测试文件）
- [x] 2026-09-25 用户裁定：Phase 0 → Phase 1 连做；Phase 2 / Phase 3 / A4 纳入后续计划（见 design.md §6）

## Notes

- 本任务只产出设计考虑与路线，**不实施**；用户裁定某一期后再立实施任务（回填实施 PRD 后 `task.py start`）。
- 前序事实：Session 14（语义索引/检索落地）、Session 19（API 对齐审计 + 最小权限修正，spec `optional-integration.md` §3 对齐矩阵为重对基线）。
