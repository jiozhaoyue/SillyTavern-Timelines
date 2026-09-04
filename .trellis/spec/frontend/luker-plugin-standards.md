# Luker 前端插件开发规范与最佳实践

本文档总结并沉淀了基于 Luker 官方文档（https://luker.cups.moe）以及本地运行实例（`https://127.0.0.1:8003`）实测验证的前端插件开发标准规范。

---

## 1. 插件目录与清单标准 (`manifest.json`)

Luker 的第三方插件默认存放于：
- `public/scripts/extensions/third-party/<extension-folder>/`
- 或全局扩展路径（由 `globalExtensionsPath` 指定）

### 必需文件清单
```text
scripts/extensions/third-party/SillyTavern-Timelines/
├── manifest.json       # 必需：元数据声明
├── index.js            # 必需：入口脚本 (ES Module)
├── style.css           # 可选：全局样式表（自动注入 link）
├── settings.html       # 可选：扩展设置抽屉面板
└── src/                # 源码模块（ESM）
```

### `manifest.json` 核心字段规范
```json
{
    "display_name": "Timelines",
    "loading_order": 9,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "style.css",
    "author": "city-unit",
    "version": "1.2.0",
    "homePage": "https://github.com/SillyTavern/SillyTavern-Timelines",
    "auto_update": true
}
```
- `display_name`: 显示在扩展管理界面的名称。
- `loading_order`: 加载优先级数值。数值越小越早加载；依赖基础插件应设置更小数值。
- `js`: 入口脚本相对路径，Luker 会通过 `import(...)` 动态加载该 ES 模块。
- `css`: 样式表相对路径，Luker 会自动创建 `<link rel="stylesheet">` 挂载到 `<head>`。
- `requires` / `optional`: 依赖与可选依赖插件目录名列表。

---

## 2. 上下文与宿主交互标准 (`Luker.getContext()`)

### 推荐上下文获取方式
Luker 在 `window.Luker` 上挂载了第一公民接口：
```javascript
export function getTimelinesContext() {
    return window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.() ?? getContext();
}
```

### 常用上下文对象与方法
- `context.characterId`: 当前激活角色 ID（单人聊天）。
- `context.characters`: 全局角色列表。
- `context.groupId`: 当前激活群组 ID。
- `context.groups`: 全局群组列表。
- `context.chat`: 当前打开会话的消息数组（包含 swipe 信息、消息元数据）。
- `context.eventSource`: 事件发布订阅中心（`eventSource.on(eventType, handler)`）。
- `context.eventTypes`: 标准事件常量集合：
  - `CHARACTER_MESSAGE_RENDERED`
  - `USER_MESSAGE_RENDERED`
  - `CHAT_CHANGED`
  - `CHAT_DELETED`
  - `MESSAGE_SWIPED`
- `context.SlashCommandParser`: 斜杠命令注册与执行解析器。

---

## 3. 前端 UI 挂载位置与抽屉规范

### 设置面板 (`settings.html`)
Luker 规范要求设置面板的顶层容器使用 `data-extension-name` 属性明确归属：
```html
<div id="timelines_container" class="extension_container" data-extension-name="SillyTavern-Timelines">
    <div class="timeline-view-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Timelines</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                ...设置内容...
            </div>
        </div>
    </div>
</div>
```

### UI 标准类名
- `.extension_container`: 扩展面板外层容器。
- `.inline-drawer`: 折叠抽屉标准容器。
- `.inline-drawer-toggle` / `.inline-drawer-header`: 抽屉标题栏与点击折叠触发器。
- `.inline-drawer-content`: 抽屉展开后的内容区。
- `.menu_button`: 统一酒馆按钮样式。

---

## 4. 模态框与弹窗集成规范

- **全屏模态框标准**：
  在不展示时挂载在 `.timelines-modal-storage.hidden` 内；
  打开时通过 `document.body.appendChild(modal)` 提升到 `<body>` 根节点以保证 `z-index` 与全屏定位层级不被外层父容器裁切。
  关闭时还原或设置 `display: none`。
- **现代化 Popup API**：
  Luker 支持 `context.callGenericPopup(content, type, ...)` 与 `new context.Popup(...)`，旧版 `callPopup` 字符串形式已废弃。
- **现代化 Loader API**：
  推荐使用 `context.loader.show({ message, toastMode })` 与 `context.loader.hide(handle)`，支持可中断进度条与无阻塞 Toast 模式。

---

## 5. 性能与存储设计规范 (针对 Timelines 重构)

1. **增量持久化缓存**：
   - 使用 IndexedDB (`TimelinesCache`) 进行多角色/多群聊的按需缓存。
   - 活跃会话优先直接复用当前运行态内存数据，避免重复 HTTP `/api/chats/get` 请求。
2. **图算法复杂度约束**：
   - 保证节点与有向边在遍历时的强去重（`Set` / `Map` 哈希索引）。
   - 路径回溯算法必须使用预索引父节点映射，杜绝 $O(N)$ 循环全图检索。
3. **渲染管线零阻塞**：
   - 样式映射使用原生 Cytoscape 预编译类与数据属性绑定。
   - 拓扑布局计算（如 Dagre）通过 Web Worker 异步线程计算，主线程通过 `preset` 快速吸附坐标，防止数十毫秒至数百毫秒的 UI 冻结。
