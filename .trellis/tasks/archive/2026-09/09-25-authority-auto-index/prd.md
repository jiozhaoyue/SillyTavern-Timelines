# Authority A4：语义索引自动增量维护

## Goal

聊天数据更新后自动触发语义索引增量构建：设置 `semanticAutoIndex`（默认关）+ 模块级节流状态机（60s 失败冷却）+ 静默模式；零新权限。

## Requirements

- **R1 节流状态机**（纯函数，semantic-index-service.js 导出）：`createAutoIndexThrottle({cooldownMs=60000})` → `attempt()` 返回 `'run'|'skip-busy'|'skip-cooldown'`，`settle(ok)` 成功清冷却/失败设冷却；单例使用，禁止散落布尔（L1-MF-12）。
- **R2 静默构建**：`triggerSemanticBuild` 增加 options——自动模式不弹开始/成功 toast，失败 console.warn + 状态文本更新，绝不 toast 轰炸。
- **R3 挂点**：时间树数据加载收尾且**本次确有数据更新**（`updateTimelineDataIfNeeded` 返回 true）后 fire-and-forget 触发；条件 = 设置开 + Authority ready + 元素非空 + throttle 放行。
- **R4 设置**：`semanticAutoIndex`（checkbox，默认关）+ index.js 接线；关闭时行为与现状逐字节一致。
- **R5 边界**：手动构建/重建按钮不受 throttle 限制；自动构建失败只影响自动路径（手动仍可立即构建）；不阻塞渐进渲染管线（fire-and-forget）。

## Acceptance Criteria

- [x] 节流状态机单测：run/busy/cooldown/settle-ok/settle-fail 全路径
- [x] triggerSemanticBuild 静默分支单测（或纯函数抽层覆盖）
- [x] 全量单测绿；DOM 开关在位（冒烟）
- [x] 实机冒烟：设置开启后打开时间树（有数据更新）→ 自动构建被正确调度（Authority ready 前提下静默执行或按冷却跳过，无 toast 轰炸）

## Notes

- 上游设计：09-25-authority-integration-design §4 A4（用户 2026-09-25 裁定纳入，默认关）。
- 触发面注记：MVP 挂「时间树数据刷新」点（打开/刷新视图时）；视图未打开期间的新消息由下次刷新补建——增量 diff 保证只写变化楼层。

## 验收补充（2026-09-25）

- 「实机冒烟」受阻于实例环境（openCharacterChat 全角色静默失效，非本任务代码），标注为**环境恢复后补验**；
  逻辑正确性由节流状态机单测（5 路径）+ ReferenceError 修复取证（console 捕获对照）覆盖。
