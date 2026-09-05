# 剧情分支深度量化统计与全景数据看板 Implementation Plan

## 1. 任务拆解
1. [x] 创建任务分支与 PRD/Design 规范
2. [ ] 实现 `src/analytics-service.js`:
   - `calculateTimelineStats(cy)`
   - `formatAnalyticsMarkdown(stats)`
   - `formatAnalyticsJson(stats)`
3. [ ] 编写测试 `tests/analytics.test.mjs` 并验证 100% 覆盖率
4. [ ] 实现 `src/analytics-modal.js`:
   - `openAnalyticsModal(cy)`
   - KPI 卡片、对比条、标签徽章与导出动作
5. [ ] 扩展 UI 与事件绑定:
   - `timeline.html` & `settings.html`: 添加 `.toggle-timeline-analytics` 按钮
   - `src/context-menu.js`: 添加 `tl-analytics` 菜单项
   - `style.css`: 添加样式及移动端适配
   - `index.js`: 引入并挂载点击事件
6. [ ] 端到端实机验证与自动化测试:
   - 运行全部单元测试
   - CDP 验证 Luker 实例并截图
