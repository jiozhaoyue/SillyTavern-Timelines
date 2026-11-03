# 分支检查点快照与时光机存档管理 Implementation Plan

## 1. 任务拆解
1. [x] 创建任务与规范文档 (PRD/Design)
2. [ ] 实现 `src/snapshot-service.js`:
   - `extractTimelineSnapshots(cy, context)`
   - `formatSnapshotsMarkdown(snapshots)`
   - `saveSnapshotMetadataNative(chatIndex, messageIndex, title)`
3. [ ] 编写单元测试 `tests/snapshots.test.mjs` (覆盖提取、排序、搜索与格式化)
4. [ ] 实现 `src/snapshot-modal.js`:
   - `openSnapshotGalleryModal(cy, context)`
   - 时间轴卡片流、实时搜索过滤、双向定位、跨分支切换
5. [ ] UI 集成与样式:
   - `timeline.html` / `settings.html`: 增加 `.toggle-branch-snapshots` 按钮
   - `src/context-menu.js`: 增加节点右键快照标记菜单
   - `style.css`: 增加时光机样式
   - `index.js`: 引入并挂载点击事件
6. [ ] 端到端实机验证与自动化测试:
   - 运行全部单元测试
   - CDP 验证 Luker 实例
