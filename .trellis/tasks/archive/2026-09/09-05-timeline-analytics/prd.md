# 剧情分支深度量化统计与全景数据看板 PRD

## 1. 背景与目标
在酒馆复杂多线角色扮演剧情树中，玩家经过数百轮对话和多次分支重试后，难以直观把握剧本全貌与数据特征。
本功能旨在提供一套全景量化统计分析服务（Analytics Service）与可视化数据看板（Analytics Modal）：
1. 拓扑结构量化：总节点数、叶子节点（结局数）、最大剧情深度、平均分叉度（Branching Factor）、分叉关键节点数。
2. 角色对白分析：User 与 Character 轮次分布、字数规模、单次平均发言长度、发言字数比（Ratio）。
3. 探索度与交互统计：Swipes 重试深度（总 Swipe 数、单轮最高重试数、平均 Swipe 数）、标签与书签覆盖率与最高频标签排行。
4. 一键导出报告：支持将分析数据一键复制/下载为结构化 JSON 或美观的 GitHub Flavored Markdown 分析研报。
5. 纯算法解耦与零原生依赖：统计基于 Cytoscape 图节点元数据计算，不污染、不篡改原生聊天数据。

## 2. 功能需求与交付项
1. `src/analytics-service.js`:
   - `calculateTimelineStats(cy)`: 纯函数计算全量拓扑指标、角色对白字数分布、Swipes 探索深度与标签排行。
   - `formatAnalyticsMarkdown(stats)`: 将统计结果格式化为高颜值 Markdown 研报。
   - `formatAnalyticsJson(stats)`: 将统计结果格式化为规范 JSON。
2. `src/analytics-modal.js`:
   - 模态弹窗 UI，支持暗色毛玻璃与主题适配。
   - 顶部核心 KPI 卡片流（总节点、结局分支数、最大深度、分支决策比）。
   - 角色发言字数进度条比例图、Swipes 探索度量、高频标签徽章展示。
   - 导出为 Markdown / JSON 与一键复制按钮。
3. UI 与工具栏集成:
   - 在 `timeline.html` / `settings.html` 顶部工具栏增加 `.toggle-timeline-analytics` 图标按钮 (`fa-solid fa-chart-pie`)。
   - 在 `src/context-menu.js` 画布右键菜单增加 `tl-analytics` 菜单项。
   - `style.css` 增加相应样式与响应式断点。
4. 测试与验证:
   - 单元测试 `tests/analytics.test.mjs` 覆盖空图、单线图、多分支图、极端情况指标计算。
   - Chrome CDP 实机测试验证弹窗呼出与指标渲染。
