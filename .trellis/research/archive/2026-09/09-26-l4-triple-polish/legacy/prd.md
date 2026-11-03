# Timelines 小改进三连：多树收尾+语义空态+TODO 清理

## Goal

L4 线多树视图 v1 交付后的三项小改进（用户 2026-09-26 选定）：
① 多树 v1 收尾打磨（跨树 dbltap 导航 E2E 补覆盖 + 树徽标配色增强）；
② 语义检索空态引导提示（区分「未建索引」与「无结果」）；
③ 边标签 TODO 评估收口（src/utils.js 两处疑问出结论，关闭或小修）。

## Background

- 多树 v1（09-26-multi-tree-view-impl，`d7a6465`）已交付：168 单测 + 11/11 E2E 全绿。
  journal Next Steps 留两条 v1 缺口：跨树 dbltap 导航未 E2E 化（核心逻辑已纯函数化单测，
  缺的是实机覆盖）；树徽标配色可复用 generateUniqueColor 增强。
- 语义全局弹窗（semantic-global-modal.js:84）空态只有笼统的「未找到可穿越的跨会话结果」，
  未区分「Authority 未装/未建索引」（应引导）与「确实无结果」（应如实说）。
- src/utils.js:142-143（openDrawer 样式类疑问）与 :288（goToSwipe 可上移 ST 前端）为登记在册 TODO，
  属「评估后关闭或小修」性质。
- 本任务为**轻量任务**（三项均为小改动含单测，PRD-only）。

## Requirements

- R1（多树收尾）：
  - R1.1 E2E：在 tests/e2e/phase0-authority.mjs 多树步骤内增补「跨树 dbltap 导航」子断言
    ——多树模式下对非当前树节点触发双击路径（经 prepareMultiTreeNavigation 守卫），断言
    selectCharacterById 被调用且导航发生（v1 覆盖缺口闭合）。
  - R1.2 徽标配色：多树横幅/图内树徽标复用 generateUniqueColor（按 treeId 稳定取色，
    与检查点路径着色同源的确定性配色纪律）。
- R2（语义空态）：
  - R2.1 semantic-global-modal 空态区分两分支：检索时聚合各 namespace 的索引状态
    （复用 semantic-index-service 的 index_state 聚合，A3/D1 先例），若「有 namespace 未建索引」
    → 空态文案改为引导式（提示去语义设置建索引/未装 Authority 的降级说明）；
    全部已建索引且无结果 → 维持现文案。
  - R2.2 文案与 DOM 结构改动需同步语义单测断言（若有既有断言）。
- R3（TODO 评估）：
  - R3.1 openDrawer：核实该样式类在宿主 ST/Luker 与本仓的实况，出结论（保留/删除/改名）并落注释。
  - R3.2 goToSwipe：评估「上移 ST 前端」的可行性（属上游，本仓不可为），出结论落注释；
    若不可为则明确关闭该 TODO。

## Acceptance Criteria

- [ ] AC-1：E2E 多树步骤含跨树 dbltap 子断言，11/11 → 全部步骤（含新增子断言）通过（Dev Luker 8003）。
- [ ] AC-2：树徽标配色按 treeId 稳定（同 treeId 永远同色），复用 generateUniqueColor，无新增硬编码色值。
- [ ] AC-3：语义空态两分支可区分：未建索引时显示引导文案（含可操作提示），无结果时维持现文案；单测覆盖两分支。
- [ ] AC-4：utils.js 两处 TODO 出结论落注释；`node --check` 通过。
- [ ] 一次编译型验证：node --check 全部改动文件 + node --test 全量绿（基线 168）。

## Out of Scope

- ChatFilesys 兼容性相关（只读模式开关、共存诊断）——已在重合分析中提出，属另立项项。
- 多树 v2 特性（跨树检索增强等）。

## Notes

- 轻量任务 PRD-only。R1.1 的 E2E 需 Dev Luker（8003）运行中。
- R3 属评估型：结论以代码注释形式落盘（上游不可为的明确关闭）。
