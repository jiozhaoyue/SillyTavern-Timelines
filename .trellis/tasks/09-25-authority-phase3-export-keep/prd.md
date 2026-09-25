# Authority Phase 3：导出服务端留存（storage.blob）

## Goal

超大画幅导出（PNG/SVG）可选留存到 Authority 服务端 blob；「导出历史」弹窗支持列表/重新下载/删除。新增授权项 `storage.blob`（low 风险），设置开关默认关。

## Requirements

- **R1 服务模块**（新 `src/export-history-service.js`，Node 可测，client 注入）：blob 名前缀 `tl-export/`；`buildExportBlobName`/`parseExportBlobName`（纯函数往返）；`saveExportToServer`（blob.put，content=base64）、`listExportHistory`（list→前缀过滤→时间倒序）、`downloadExportFromServer`（get→base64→Uint8Array）、`deleteExportFromServer`。
- **R2 导出钩子**：export-modal 下载分支成功后，若 `settings.exportServerKeep` 且 Authority ready → fire-and-forget 留存 + toast 结果；失败不影响本地下载。
- **R3 导出历史 UI**（新 `src/export-history-modal.js`，DOM 模块，document 短路）：列表（名称/大小/时间）+ 下载/删除/关闭；设置区「导出历史」按钮入口。
- **R4 权限**：`AUTHORITY_DECLARED_PERMISSIONS` 加 `storage:{blob:true}`（不声明 kv）；负断言更新。
- **R5 设置**：`exportServerKeep`（checkbox，默认关）+ 接线。
- **R6 质量门**：单测（名称往返/base64 往返/list 过滤排序/put/get/delete 调用形状）；全量绿；实机 blob 数据面冒烟（save→list→get→delete 往返，不依赖会话打开）。

## Acceptance Criteria

- [x] 名称构建/解析往返 + 非 tl-export/ 前缀解析为 null（单测）
- [x] base64 往返（含中文文件名字节）单测
- [x] 桩 client 下 list 过滤/排序、put/get/delete 形状断言
- [x] 权限声明含 storage.blob 且不含 kv；负断言通过
- [x] 实机 blob 数据面往返冒烟通过（截图）
- [x] 全量 `node --test tests/*.test.mjs` 绿

## Notes

- 数据边界：导出物可从图谱随时重建（派生物），合规 L1-MF-4；删除 Authority 数据即重置。
- 用户裁定：Phase 3 纳入（2026-09-25）。
- 环境注记：当前实例 openCharacterChat 全角色静默失效（宿主层），导出 UI 全链路实机验证为补验项；blob 数据面（Authority 直接调用）不受影响。
