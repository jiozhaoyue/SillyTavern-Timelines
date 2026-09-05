# PRD: 时间树与 Luker 记忆图 (memory-graph) 主动深度联动与 API 暴露

## 1. 背景与目标

在 Luker 生态中，官方记忆图插件 `memory-graph` 负责管理长期情景记忆（Event）、地点状态（Location）与角色状态（Character），并执行多轮对话的语义向量检索与动态提示词注入。
目前主流外部插件往往各自独立运行。用户明确指出：“**主要是主动去给别的插件，其他插件基本都不来读的**”。
本任务旨在实现 Timelines 与 Luker 官方 `memory-graph` 的主动深度双向联动，并将时间树的分支拓扑结构封装为标准扩展 API 对外暴露。

### 核心收益
1. **记忆与剧情因果树融合**：用户在时间树中不仅能看到对话分支，还能直观看到哪些节点沉淀为了长期记忆、当前轮次哪段记忆正在被 LLM 召回生效。
2. **记忆里程碑全景过滤**：长篇 RP 中剧情枝繁叶茂，一键高亮记忆里程碑，让用户瞬间把握角色关系的演进主脉络。
3. **节点快速补录记忆**：在时间树任意节点右键即可直接联动 `memory-graph` 录入情景事件，无需在不同插件间来回切换。
4. **开放标准扩展接口**：通过 `registerExtensionApi('timelines', ...)` 开放分支因果链和最近公共祖先 (LCA) 计算，赋能外部向量检索或分析工具。

---

## 2. 功能需求详情

### 2.1 节点记忆状态识别与视觉徽章
- **关联查询**：
  - 基于节点 `messageId`，通过 `memory-graph.getAssistantSeqForMessageIndex` 解析为 assistant 序列号 `seq`。
  - 通过 `memory-graph.findEventBundleBySeq` 获取该楼层覆盖的记忆事件 `{ event, location, characters }`。
- **视觉呈现**：
  - 拥有记忆事件的节点添加 `.has-memory` 样式类（高亮紫色边框与微光环）。
  - 若该记忆在 `getCurrentInjection` 中命中 `recallSelectedIds`，赋予高亮青绿呼吸光环（表示当前正在被模型召回使用）；若命中 `alwaysInjectIds`，赋予金黄色边框。
- **优雅降级**：
  - 若 `memory-graph` 未启用或不可用，静默跳过查询，绝不抛错，保障核心时间线功能独立完整。

### 2.2 节点信息卡片 (Popup/Tooltip) 联动展示
- 鼠标悬浮或点击节点时，卡片内动态注入记忆信息板块：
  - 🧠 记忆事件：标题及关键摘要。
  - 📍 发生地点：地点名称。
  - 👥 涉及人物：参与角色列表。
  - ⚡ 注入状态标签：区分“本轮已召回注入”、“持久置顶注入”与“未激活”。

### 2.3 记忆里程碑过滤器 (Memory Milestones)
- 在工具栏增加记忆过滤器切换按钮（图标：`fa-solid fa-brain`）。
- 开启后：
  - 隐藏或淡化（`opacity: 0.15`）所有未产生记忆的琐碎对话节点。
  - 仅高亮展示产生长期记忆的关键节点及其因果关联线。
  - 小地图同步高亮记忆节点。

### 2.4 右键上下文菜单联动
- 节点右键菜单新增选项：
  - 若已有记忆：`在记忆图中查看此记忆`（展示详情弹窗）。
  - `为此节点补录记忆`：打开极简表单弹窗（标题、摘要），调用 `memory-graph.openSession().createNode` 快速沉淀为当前楼层的记忆事件。

### 2.5 对外暴露 Timelines 标准扩展 API
- 注册 `Luker.getContext().registerExtensionApi('timelines', ...)`，导出：
  - `getTimelineTree()`: 当前树拓扑 elements。
  - `getBranchLineage(chatFileName, messageId)`: 从 root 到指定节点的消息因果链。
  - `getCurrentBranchNodes()`: 当前活动分支的全部有序节点。
  - `computeBranchLCA(nodeAId, nodeBId)`: 两个节点的最近公共祖先。
  - `onBranchSwitched(callback)`: 分支切换监听。

---

## 3. 验收标准

1. 单元测试覆盖率：`tests/memory-interop.test.mjs` 测试覆盖记忆查询映射、注入状态计算、API 导出与 LCA 算法，全部测试通过。
2. 现有 30 项单元测试无任何回归错误。
3. `memory-graph` 未加载或缺少某些方法时，时间树无报错、正常初始化。
4. CDP 运行验证：在真实 Luker 环境下，时间树能正确展示记忆徽章、弹窗卡片与里程碑过滤。
