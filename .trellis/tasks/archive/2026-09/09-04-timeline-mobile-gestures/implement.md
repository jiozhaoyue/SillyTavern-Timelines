# 实施计划: 移动端触控手势与小屏幕适配优化 (Implementation Plan)

## 实施步骤清单

### Phase 1: 触控参数配置与手势绑定 (`index.js`)
- [x] 在 `initializeCytoscape` 中增加 `touchTapThreshold: 10`、`boxSelectionEnabled: false`、`autoungrabify: true`。
- [x] 在 `setupEventHandlers` 中实现移动端 `taphold` 弹出右键菜单或操作动作，并保留原有 swipe 展开能力。

### Phase 2: 响应式视口与触控 CSS 重构 (`style.css`)
- [x] 设置 `#timelinesDiagramDiv` 的 `touch-action: none` 与 `-webkit-touch-callout: none`。
- [x] 增加 `@media (max-width: 768px)` 与 `@media (max-width: 480px)` 响应式样式：
  - 优化移动端 `#networkContainer` 全屏化与内边距。
  - 优化顶栏控制按钮触控热区（>= 36px）与弹性排布。
  - 优化移动端 Diff View 对比窗口与卡片排版。
  - 优化移动端上下文菜单项触控高度（>= 44px）。

### Phase 3: 自动化测试与实机验证
- [x] 编写触控阈值与配置单元测试。
- [x] 使用 CDP 模拟移动端视口（iPhone / Pixel 尺寸）并截屏验证渲染效果。
