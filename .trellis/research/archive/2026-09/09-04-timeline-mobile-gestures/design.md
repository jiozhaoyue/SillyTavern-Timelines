# 技术方案设计: 移动端触控手势与小屏幕适配优化 (Design Document)

## 1. 触控事件流与手势解耦

```text
[Touch Input: 1 Finger]  ──> cytoscape: pan (单指平移)
[Touch Input: 2 Fingers] ──> cytoscape: pinch-to-zoom (双指捏合缩放)
[Touch Input: Tap]       ──> cytoscape: tap (展示消息详情面板)
[Touch Input: TapHold]   ──> cytoscape-context-menus: 在触点坐标呼出菜单
```

### 1.1 手势冲突消除
- CSS 设置 `#timelinesDiagramDiv { touch-action: none; -webkit-touch-callout: none; }`
- 初始化 Cytoscape 时配置：
  ```javascript
  touchTapThreshold: 10,
  desktopTapThreshold: 4,
  boxSelectionEnabled: false,
  autoungrabify: true, // 避免触屏拖动画布时意外挪动了单个节点位置
  ```

### 1.2 长按呼出上下文菜单设计
- 监听 `cy.on('taphold', 'node', (evt) => { ... })`：
- 获取当前事件的视口坐标 `evt.renderedPosition` 或 `evt.originalEvent.touches[0]`。
- 触发上下文菜单实例的显示逻辑，确保无鼠标右键的触屏设备拥有 100% 的分支管理与 Diff 操作能力。

---

## 2. 响应式布局设计 (`style.css`)

### 2.1 顶栏操作区 Flexbox 改造
将原 `#networkContainer` 顶部的散落浮动按钮包裹/重构为弹性布局：
- 桌面端：搜索框靠左或居中，操作按钮居右。
- 移动端 (`@media (max-width: 768px)`)：
  - 采用双行或紧凑单行：搜索框占满一行或弹性伸缩（flex: 1），常用按钮（关闭、自适应、刷新、翻转）横向排列。
  - 按钮尺寸加大至 36px × 36px，圆角阴影，易于单手操作。

### 2.2 Diff Modal 移动端适配
- 桌面端：左右双栏并列（50% / 50%）。
- 移动端 (`max-width: 768px`)：
  - 弹性切换为垂直上下排列，或顶部增加「分支 A / 分支 B」快捷选项卡切页，避免窄屏下双栏文本严重挤压换行。
