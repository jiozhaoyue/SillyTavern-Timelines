# 分支检查点快照与时光机存档管理 PRD

## 1. 背景与目标
在多分支交互式小说和跑团故事中，玩家在不同剧情支线探索时，常常会在关键分歧处打上书签或里程碑。然而，现有功能缺乏一个统一的“时光机存档画廊”（Time Machine / Checkpoint Archive），无法直观按时间线或分支树纵览全部重要时刻，也无法一键跨会话穿越。
本功能旨在提供一套分支剧情检查点快照服务（Snapshot Service）与时光机归档画廊（Snapshot Modal）：
1. 检查点自动扫描与聚合：从 Cytoscape 节点或原生会话数据中自动提取所有带有书签（bookmark）、特定里程碑标签或快照备注的关键节点。
2. 快照元数据：包含楼层、所属分支会话名、发信人角色、摘要内容截断、自定义快照别名与标注标签。
3. 双向联动能力：
   - “视口聚焦定位”：平滑缩放并居中到该节点，并施加高亮呼吸脉冲。
   - “跨分支时空穿越”：利用原生 `openCharacterChat(chatFile)` 快速切换到该分支，并定位到对应楼层。
4. 快照管理：支持对当前选中节点一键打上/移除“时光机快照”，支持快照重命名与导出。
5. 零耦合与数据合规：基于原生 `message.extra` 与酒馆 `openCharacterChat` 协议，无外部私有数据库。

## 2. 交付项
1. `src/snapshot-service.js`:
   - `extractTimelineSnapshots(cy, chatSessions)`: 提取并排序所有检查点快照。
   - `formatSnapshotsMarkdown(snapshots)`: 导出快照清单为 Markdown。
2. `src/snapshot-modal.js`:
   - 时光机归档画廊模态窗，时间轴列表展示、搜索过滤、一键定位、一键切换分支。
3. UI 集成:
   - 工具栏增加 `.toggle-branch-snapshots` (`fa-solid fa-clock-rotate-left`)。
   - 节点右键菜单增加“⭐ 标记/编辑时光机快照”动作。
   - `style.css` 增加时光机样式与移动端适配。
4. 测试与验证:
   - 单元测试 `tests/snapshots.test.mjs`。
   - Chrome CDP 实机测试并在 Luker 端到端验证。
