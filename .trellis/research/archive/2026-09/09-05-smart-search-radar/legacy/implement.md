# 智能全景雷达与多维复合检索器 Implementation Plan

## 1. 任务拆解
1. [x] 创建任务与技术设计规范 (PRD/Design)
2. [ ] 实现 `src/search-service.js`:
   - `parseSearchQuery(queryString)`
   - `matchesNode(nodeData, filterOptions, parsedQuery)`
   - `filterGraphNodes(nodes, filterOptions)`
3. [ ] 编写单元测试 `tests/search-radar.test.mjs` (涵盖正则、普通文本、角色、书签、楼层范围)
4. [ ] 实现 `src/search-radar.js`:
   - 搜索栏旁置步进器控件 (上一个、下一个、数量指示徽章、过滤筛选器弹窗)
   - 键盘 `Enter` / `Shift+Enter` / `Escape` 监听
   - 视口居中与脉冲高亮联动
5. [ ] UI 集成与样式:
   - `timeline.html` / `settings.html`: 增加雷达步进器容器
   - `style.css`: 增加雷达控制条与多维过滤气泡面板样式
   - `index.js`: 引入并初始化 `SearchRadar`
6. [ ] 端到端实机验证与自动化测试:
   - 运行全部单元测试
   - CDP 验证实机交互与截图
