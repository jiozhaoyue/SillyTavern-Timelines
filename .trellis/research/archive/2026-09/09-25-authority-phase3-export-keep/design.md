# 实施设计：导出服务端留存

## 数据流

```
导出成功（PNG blob / SVG blob）
  └─ settings.exportServerKeep && authority ready
      └─ saveExportToServer({client, name: buildExportBlobName(...), bytes, contentType})
          └─ blob.put({name, content: toBase64(bytes), encoding:'base64', contentType})
              └─ [SDK 自动判断 inline/transfer 阈值]
导出历史弹窗
  └─ listExportHistory → BlobRecord[]（前缀过滤 + updatedAt 倒序 + parse 元数据）
      ├─ 下载：downloadExportFromServer → base64 → Uint8Array → Blob URL → a.download
      └─ 删除：deleteExportFromServer → 刷新列表
```

## 关键点

1. blob 名：`tl-export/<ISO时间戳>-<kind>-<角色名>.<ext>`；parse 用前缀 + 首段 ISO 校验，不匹配返回 null。
2. base64：浏览器实现（btoa + Uint8Array 分块，避免 apply 栈溢出）；Node 测试走同一实现。
3. 权限：`storage:{blob:true}`——DeclaredPermissions.storage 形状 `{kv?, blob?}`，只声明 blob。
4. 留存 fire-and-forget：任何失败只 toast.warn，不影响本地下载主链路（L0-11）。
