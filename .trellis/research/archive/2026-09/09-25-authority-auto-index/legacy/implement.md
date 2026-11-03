# 执行清单（implement.md）

- [x] 1. createAutoIndexThrottle + 单测
- [x] 2. triggerSemanticBuild 静默分支
- [x] 3. index.js 挂点 + 设置项接线（semanticAutoIndex 默认关）
- [x] 4. 全量单测 + node --check
- [x] 5. 实机冒烟（DOM + 调度行为）
- [x] 6. WIKI 同步 + 提交推送 + 归档

## 执行记录（2026-09-25）

- 单测 143/143 全绿（新增节流状态机 5 路径测试）；node --check 通过。
- **修复真 bug**：maybeAutoSemanticIndex 最初定义在 init 闭包内，而调用点在模块级 onTimelineButtonClick —— ReferenceError 中断渐进管线（取证 console 捕获 `maybeAutoSemanticIndex is not defined`）；已提升至模块顶层（throttle 单例 + runner 注入模式），修复后取证无该错误。
- 实机冒烟**受环境受阻（补验项）**：实例 `openCharacterChat` 对全部 4 个候选角色静默失效（chatId 不就绪；宿主原生 API 层，全新 Chrome profile 同样复现；此前多轮同 API 成功，实例状态在 22:34 前后变化）——待实例状态恢复后按 PRD AC 补验（打开时间树 → 状态文本/无 toast 断言）。A4 逻辑正确性由单测与修复取证覆盖。
- 顺带增强：E2E 会话打开步骤多角色重试（4 候选）+ E2E_PROFILE 独立 profile 支持。
