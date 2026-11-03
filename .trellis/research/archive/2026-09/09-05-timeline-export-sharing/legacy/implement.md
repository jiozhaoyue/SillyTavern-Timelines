# Implementation Plan: 超大画幅高保真导出与长图分享系统

## 阶段划分 (Phased Plan)

### Step 1: 核心离线渲染与导出引擎 (`src/export-service.js`)
- 实现 `calculateSafeScale(boundingBox, desiredScale, maxDimension)` 纯数学安全缩放计算。
- 实现 `composeMetadataBanner(canvas, metadata)` 离线合成精致水印卡片。
- 实现 `exportTimelineAsPng(cy, options)` 与 `exportTimelineAsSvg(cy, options)`。
- 实现 `triggerDownload(blob, filename)` 与 `copyToClipboard(blob)`。
- 编写纯单元测试 `tests/export.test.mjs`。

### Step 2: 交互式导出模态框与 UI 集成 (`src/export-modal.js`)
- 设计并构建 `.timelines-export-modal` 对话框：
  - 格式切换（PNG 1x/2x/4x, SVG）；
  - 范围切换（全图 / 当前视口）；
  - 水印选项与背景色选项；
  - 实时预估分辨率与卡片预览。
- 在 `timeline.html` 与 `settings.html` 顶栏增加 `.export-timeline-btn`（`fa-solid fa-camera`，标题“导出时间线长图/矢量图”）。
- 在 `src/context-menu.js` 空白画布菜单中增加“📷 导出时间线图”。
- 在 `style.css` 中编写导出弹窗、格式单选卡片与操作按钮样式。

### Step 3: 全量回归测试与实机 CDP 验证
- 运行全量单元测试：`node --test tests/*.test.mjs`。
- 通过 Chrome CDP 连接实机测试导出模态框唤起、PNG 生成与 Blob 导出。
- 保存实机导出的测试图片并抓取完整截图。
- 更新 walkthrough 与 Trellis 任务归档。
