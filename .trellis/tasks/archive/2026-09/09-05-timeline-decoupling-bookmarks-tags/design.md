# Design: 通用扩展装饰器架构解耦与原生书签彩色标签系统

## 1. 架构演进与微内核设计 (Architecture & Microkernel)

### 演进前（紧密耦合）：
```
[ Timelines 核心 (style.js, index.js, lod-service.js) ]
                ▲                     ▲
                │ (硬编码直接调用)      │
                ▼                     ▼
       [ memory-graph API ]   [ hasMemory 硬编码选择器 ]
```

### 演进后（微内核开放装饰器总线）：
```
                             [ Timelines Core ]
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
[ Extension API Bus (src/api.js) ]             [ Native Tag Manager (src/tag-manager.js) ]
- registerNodeDecorator()                      - Reads/Writes ST native message.extra
- registerToolbarAction()                      - Zero proprietary backend storage
- registerContextMenuAction()                  - Bookmarks & Tags Drawer UI
           ▲                                                   ▲
           │                                                   │
  ┌────────┴───────────────────────────┐                       │
  │ (通过通用开放接口注入，核心零依赖)    │                       │
  │                                    │                       │
[ Memory-Graph Adapter ]     [ Third-Party Extensions ]        │
(src/adapters/mg-adapter.js) (Community / User Plugins)        │
  │                                                            │
  └────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块与接口设计 (Module & Interface Design)

### 2.1 微内核装饰器总线 (`src/api.js`)

- **节点修饰器注册 (`registerNodeDecorator`)**：
  ```javascript
  registerNodeDecorator({
      id: 'unique_id',
      priority: 10,
      decorateNode(cyNode, nodeData) {
          // 可添加 cyNode.addClass('...'), cyNode.data('...', ...)
      },
      getTooltipPrefix(cyNode) {
          // 返回悬停提示前缀（如 '🧠 ' 或 '🏷️ '）
      },
      getCardSection(cyNode) {
          // 返回点击完整卡片中的额外 HTML 块
      },
      isProtected(nodeData) {
          // 返回 boolean，告知 LOD 引擎是否不可折叠
      }
  });
  ```
- **工具栏与右键菜单动态注册**：
  - `registerToolbarAction({ id, title, iconClass, onToggle(active, cy) })`：时间线顶栏动态挂载按钮。
  - `registerContextMenuAction({ id, content, onClick(node) })`：右键菜单动态挂载功能。

### 2.2 原生书签与彩色标签管理 (`src/tag-manager.js`)

- **原生数据契约**：
  - 读取：从节点关联的 `group[0].message.extra.tags` 中读取标签数组 `[{ name, color }]`。
  - 写入：
    ```javascript
    async function updateMessageTags(messageId, tags) {
        const context = getTimelinesContext();
        // 1. 获取当前活动聊天中的原生消息对象
        const message = context.chat?.[messageId];
        if (!message) return false;
        if (!message.extra) message.extra = {};
        message.extra.tags = tags;
        // 2. 调用酒馆原生保存方法
        await context.saveChatDebounced();
        return true;
    }
    ```
- **顶部书签抽屉 (`.timelines-tags-drawer`)**：
  - 工具栏按钮 `.toggle-tags-drawer`（`fa-solid fa-bookmark`）触发展开/收起；
  - 抽屉展示：
    1. 标签统计与过滤药丸（全部、主线、战斗、日常等）；
    2. 带标节点流式卡片列表（包含楼层、角色、文本摘要、所属分支）；
    3. 点击任意卡片：调用 `cy.animate({ center: { eles: targetNode }, zoom: 1.2 })` 并闪烁聚焦。

### 2.3 记忆图适配层纯化 (`src/adapters/memory-graph-adapter.js`)

- 将原本散落在 `src/style.js`, `src/lod-service.js`, `index.js`, `src/context-menu.js` 中的记忆图相关代码抽离。
- 作为标准的 `nodeDecorator` 与 `toolbarAction` 动态注册到总线：
  - 若环境中存在 `memory-graph`，则注册并挂载；
  - 若不存在，静默跳过，Timelines 核心零污染、零硬编码。
