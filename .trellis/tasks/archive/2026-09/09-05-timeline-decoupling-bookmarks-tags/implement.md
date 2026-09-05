# Implementation Plan: 通用扩展装饰器架构解耦与原生书签彩色标签系统

## 阶段划分 (Execution Steps)

### Step 1: 扩展微内核总线与解耦重构
- 修改 `src/api.js`：
  - 实现 `registerNodeDecorator(decorator)`、`getNodeDecorators()`。
  - 实现 `registerToolbarAction(action)`、`getToolbarActions()`。
  - 实现 `registerContextMenuAction(action)`、`getContextMenuActions()`。
- 重构 `src/lod-service.js`：
  - 移除对 `d.hasMemory` 的硬编码，通过传入的 `protectedNodeIds` 或 decorator 查询保护状态。
- 重构 `src/style.js`：
  - 记忆相关样式移至通用自定义类（如 `node.custom-badge-highlight`），或由装饰器动态注册。
- 新建 `src/adapters/memory-graph-adapter.js`：
  - 封装记忆图的所有发现与数据转化，并通过 `registerNodeDecorator` 与 `registerToolbarAction` 注册。

### Step 2: 实现酒馆原生书签与彩色标签管理系统
- 新建 `src/tag-manager.js`：
  - 实现原生 `message.extra.tags` 的纯函数提取与更新方法。
  - 实现原生书签标记与分类色卡生成。
  - 注册为内置的 `TagNodeDecorator`。
- 新建 `tests/tag-manager.test.mjs` 与 `tests/decorator-bus.test.mjs`：
  - 测试微内核修饰器总线注册、排序与保护集计算。
  - 测试原生标签读写提取逻辑（纯内存 mock）。

### Step 3: UI 抽屉、弹窗与交互集成
- 修改 `timeline.html` 与 `settings.html`：
  - 顶部工具栏增加书签抽屉开关 `.toggle-tags-drawer`（`fa-solid fa-bookmark`）。
  - 添加顶部可折叠的 `.timelines-tags-drawer` DOM 容器。
- 修改 `style.css`：
  - 编写书签与标签抽屉的半透明毛玻璃样式、卡片流、标签色环与移动端响应式布局。
- 修改 `src/context-menu.js`：
  - 动态集成装饰器注册的右键项；
  - 增加「管理标签与书签」弹窗。
- 修改 `index.js`：
  - 在图渲染与节点卡片渲染时，统一遍历执行已注册的 NodeDecorators。
  - 点击抽屉卡片一键平滑跳转至对应节点。

### Step 4: 自动化回归测试与实机 CDP 验证
- 运行全量测试套件：`node --test tests/*.test.mjs`，确保全部测试通过。
- 启动 live Luker CDP 验证：
  - 验证标签添加与删除；
  - 验证书签抽屉展开与平滑定位；
  - 验证即使禁用 memory-graph，Timelines 依然 100% 洁净运行；
  - 捕获实机运行截图。
