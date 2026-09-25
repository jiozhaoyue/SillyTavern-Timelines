# 执行清单（implement.md）

- [x] 1. src/export-history-service.js（纯函数 + IO）+ 单测
- [x] 2. 权限 storage:{blob:true} + 负断言更新
- [x] 3. export-modal 留存钩子 + settings 开关/历史按钮接线
- [x] 4. export-history-modal.js + CSS
- [x] 5. 全量单测 + node --check
- [x] 6. 实机 blob 数据面往返冒烟（截图）
- [x] 7. WIKI/README + 提交推送 + 归档

## 执行记录（2026-09-25）

- 单测 147/147 全绿（新增导出历史 4 项：名称往返/清洗、base64 往返与分块、桩 CRUD 与过滤排序、留存开关短路）。
- **实测发现**：`blob.list()` 实际直返 `BlobRecord[]` 数组（SDK 源码类型标注 `{entries}` 与部署版行为不符）——listExportHistory 做数组优先容错；blob id 为名字 slug 形态（如 `tl-export_xxx.png`）。
- 实机 blob 数据面冒烟全绿（phase3_smoke.png）：save → list（listed:true）→ get 字节往返 → delete；DOM 三项（留存开关/历史按钮/区 toggle）在位。
- 导出 UI 全链路（真实 PNG 渲染后留存）受实例会话打开失效影响为**补验项**（同 A4）。
