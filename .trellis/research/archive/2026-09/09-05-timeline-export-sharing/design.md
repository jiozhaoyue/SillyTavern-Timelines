# Technical Design: 超大画幅高保真导出与长图分享系统

## 1. 架构设计与模块划分 (Architecture & Modules)

```
[ 用户点击顶栏 .export-timeline-btn ]
              │
              ▼
    [ openExportModal(cy) ] ──> 收集图谱统计与会话元数据 (角色名/节点数/分支数)
              │
              ▼
    [ ExportService (纯前端离线渲染引擎) ]
    ├── 1. 计算裁剪与安全缩放比 (capping max 8192px)
    ├── 2. 调用 cy.png() 或 cy.svg() 提取矢量/高分辨率位图
    ├── 3. 若启用元数据水印卡片：
    │      在离线 Canvas 下方绘制信息栏 (Banner/Card) 并在二者间合成
    └── 4. 输出 Blob 对象
              │
              ├──> [ ⬇️ downloadBlobAsFile(blob, filename) ]
              └──> [ 📋 copyBlobToClipboard(blob) ]
```

### 1.1 核心模块 `src/export-service.js`
- `calculateSafeScale(cy, desiredScale, maxDimension = 8192)`:
  - 纯函数计算：防止视口/全图 bounding box 放大后超过 Canvas 最大像素限制引发浏览器静默崩溃。
- `generateTimelinePngBlob(cy, options)`:
  - 调用 `cy.png({ full, scale, maxWidth, maxHeight, bg })`。
  - 如需拼接水印，通过辅助 Canvas 离线叠加会话元数据 Footer（角色名、会话文件、节点数、生成时间戳）。
- `generateTimelineSvg(cy, options)`:
  - 生成 SVG 文本或 Blob。
- `downloadFile(blob, filename)`:
  - 利用原生 `<a download="...">` 触发静默下载。
- `copyImageToClipboard(blob)`:
  - 利用原生 `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`。

### 1.2 导出弹窗 `src/export-modal.js`
- 挂载半透明毛玻璃浮层 `.timelines-export-modal`。
- 提供格式选项单选（PNG 标清 1x、高清 2x、超清 4x；SVG 矢量）。
- 提供范围勾选（全部分支整图 / 当前可见窗口）。
- 提供水印卡片勾选。
- 预览尺寸与预估文件大小计算展示。

---

## 2. 边界条件与健壮性设计 (Edge Cases & Resilience)
1. **超大分支图 Canvas OOM 保护**：
   - 当节点数 > 500 时，若全图尺寸超过 8192x8192，`calculateSafeScale` 自动限制最大输出分辨率，并给出用户友好提示。
2. **剪贴板权限受限降级**：
   - 某些浏览器在非 HTTPS、或没有聚焦页面时 `navigator.clipboard.write` 会抛出 `NotAllowedError`，此时自动捕获并弹出 toastr 提示用户直接点击“下载文件”。
3. **主画布零侵入**：
   - 导出全图使用 Cytoscape 的离线导出选项，完全不修改主图当前的 pan/zoom 视口状态。
