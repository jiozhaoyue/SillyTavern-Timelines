# PRD: 通用扩展装饰器架构解耦与原生书签彩色标签系统

## 1. 背景与目标 (Background & Goals)

SillyTavern-Timelines 是一个专注因果时间树与多分支导航的基础可视化插件。
根据工程规范与架构定位：
1. **彻底解耦**：Timelines 核心（图构建、样式映射、LOD 性能抽稀）必须与任何特定的第三方扩展（如 `memory-graph`）保持 100% 零耦合。Timelines 应当纯粹作为底层拓扑与可视化引擎，通过**对外暴露标准开放式 API**（微内核装饰器总线），允许任何外部插件动态挂载节点徽章、卡片与工具栏动作。
2. **纯酒馆原生功能契约**：所有关于聊天文件与消息属性的读写，必须 100% 基于酒馆原生消息 `message.extra` 体系与原生会话保存机制（`saveChatDebounced()` / `/api/chats/save`），严禁构建私有数据库或侵入性聊天存储格式。
3. **原生书签与自定义彩色标签系统**：
   - 支持为时间树任意节点添加、编辑或删除书签与多色彩色标签（如「主线」、「战斗」、「闲聊」等）；
   - 提供顶部折叠式「书签与标签索引抽屉」，支持按标签分类过滤、统计并在时间树上一键平滑定位；
   - 对外暴露标签与书签查询/打标 API，供宿主或其他插件调用。

---

## 2. 需求列表 (Requirements)

### R1: 微内核开放式扩展装饰器总线 (`src/api.js`)
- 在 `Luker.getContext().registerExtensionApi('timelines', api)` 中增加标准扩展接入接口：
  - `registerNodeDecorator(decorator)`：
    - `decorator.id`: 唯一标识（如 `'memory-graph'`、`'character-notes'` 等）。
    - `decorator.priority`: 渲染优先级。
    - `decorator.decorateNode(node, context)`: 为节点添加视觉 class、data 或徽标。
    - `decorator.getTooltipPrefix(node)`: 悬停提示前缀（如图标）。
    - `decorator.getCardSection(node)`: 单击节点弹出的 Tap Tippy 中的额外信息卡片 HTML。
    - `decorator.isProtected(node)`: 通知 LOD 引擎该节点受保护不可折叠。
  - `registerToolbarAction(action)`:
    - 允许外部插件向时间线顶部工具栏注册自定义控制按钮（如记忆图高亮、全景小地图等）。
  - `registerContextMenuAction(menuItem)`:
    - 允许外部插件向右键菜单注入自定义操作（如补录记忆等）。
- **解耦重构**：将现有的记忆图逻辑纯化为 `src/adapters/memory-graph-adapter.js`，通过公开装饰器接口对接；Timelines 核心源码（`src/graph-builder.js`, `src/style.js`, `src/lod-service.js`）全面清理对 `memory-graph`、`hasMemory` 等硬编码字段的直接依赖。

### R2: 基于酒馆原生的书签与自定义彩色标签系统 (`src/tag-manager.js`)
- **原生数据契约**：
  - 标签数据存储在原生消息 `message.extra.tags = [{ name: '主线', color: '#f59e0b' }, ...]`；
  - 自定义书签存储在原生消息 `message.extra.bookmark_title = '标题'` 与 `message.extra.bookmark_color = '#ef4444'`；
  - 更改后调用酒馆原生会话保存接口更新，无私有文件读写。
- **节点视觉映射**：
  - 带有彩色标签的节点在右上侧展示标签圆点或色环（通过通用装饰器或原生样式映射）；
  - 悬停与点击提示卡片展示标签 Tag Pills。

### R3: 交互式标签编辑与顶部折叠式书签索引抽屉
- **快捷编辑**：
  - 节点右键菜单提供「添加/管理标签」；
  - 点击节点详情卡片中提供「+ 标签」快捷操作弹窗。
- **书签与标签索引抽屉 (Bookmarks & Tags Drawer)**：
  - 顶部工具栏新增书签图标按钮 `.toggle-tags-drawer`（`fa-solid fa-bookmark`）；
  - 点击滑出顶部半透明抽屉，列出当前时间树的所有书签节点与标签分类；
  - 点击抽屉中任意条目，时间树视口平滑聚焦并高亮对应节点。

---

## 3. 验收标准 (Acceptance Criteria)

- [ ] Timelines 核心代码库（`src/graph-builder.js`, `src/style.js`, `src/lod-service.js`）零硬编码特定扩展名称（如 `memory-graph`），完全通过 `src/api.js` 开放微内核总线进行外部修饰。
- [ ] `memory-graph` 作为独立 Adapter，通过 `registerNodeDecorator` 接入并完整保持记忆徽章与卡片功能，但当其不存在时 Timelines 运行零报错、零性能损耗。
- [ ] 原生标签与书签系统支持在任意节点打标、编辑、删除，严格存储于酒馆原生 `message.extra`。
- [ ] 顶部书签索引抽屉能正确列出带标节点，并能点击一键平滑定位视口。
- [ ] 自动化测试全部保持 100% Pass（新增通用修饰器总线与标签管理器单元测试）。
- [ ] 通过 Chrome CDP 在运行中的 Luker 实例上进行端到端实机验证并留存截图。
