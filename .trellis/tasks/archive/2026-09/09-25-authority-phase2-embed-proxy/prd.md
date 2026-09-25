# Authority Phase 2：embedding 服务端代理（http.fetch）

## Goal

embedding-provider 增加 Authority 服务端出网通道：`createAuthorityHttpFetchAdapter` 把浏览器 fetch 翻译为 `client.http.fetch`（绕 CORS、按 hostname 治理审计），设置面板新增通道开关/model/key；权限声明新增 `http.fetch`（+1 授权项）；单测全绿 + 实机传输链路冒烟。

## 背景事实（Phase 0 实证）

- Luker fork 已移除 `/api/embeddings/compute`，宿主侧无任何原始向量化端点 → 语义索引在 Luker 完全休眠。
- Authority `http.fetch`：请求 `{url, method?, headers?, body?, bodyEncoding?}` → 响应 `{status, ok, headers, body, bodyEncoding, contentType}`（shared-types/http.ts:28-45）；权限 target=hostname；SDK 自动处理大响应 transfer。
- 权限声明 schema：`http?: { fetch?: boolean | string[] }`（shared-types/permissions.ts:43）。

## Requirements

- **R1 传输适配器**（新模块 `src/authority-http-fetch.js`，Node 可测，client 注入）：`createAuthorityHttpFetchAdapter(client)` 返回浏览器 fetch 兼容签名 `(url, {method, headers, body}) => Response-like`；Response-like 提供 `ok/status/json()/text()`；`client.http.fetch` 方法不存在时构造即抛错（调用方降级）。
- **R2 provider 扩展**（`src/embedding-provider.js`）：新增可选 `model`（请求体带 `model` + `input:[text]` 双兼容字段）与 `apiKey`（`Authorization: Bearer` 头）与 `transportResolver`（async () => fetchImpl，首次调用解析并缓存）；缺省行为逐字节不变。
- **R3 权限声明**：`AUTHORITY_DECLARED_PERMISSIONS` 新增 `http: { fetch: true }`；既有负断言同步更新（仍不含 storage.kv / jobs.background / fs / agent）。
- **R4 设置面板**：三项新增——`semanticAuthorityHttpFetch`（checkbox，默认关）、`semanticHttpModel`（text）、`semanticHttpKey`（password 型 text）；index.js 默认值/绑定映射/loadSettings 接线；provider 构造按开关组装 `transportResolver`（Authority 非 ready 时该开关不生效并 toast 提示）。
- **R5 边界如实**：密钥经扩展设置传入、随请求头出网（http.fetch 不保管密钥）——设置项 title 与 WIKI 明示；默认全关，不改既有用户行为。
- **R6 质量门**：全量单测绿；`node --check`；实机冒烟——经 `client.http.fetch` GET 实例自身 `/version`（hostname 127.0.0.1，默认策略 granted）断言 200 + JSON，验证传输与授权链路；真实第三方 embedding 调用无 key 不可测，请求形状以单测为准。

## Acceptance Criteria

- [x] 适配器单测：GET/POST 翻译、headers/body 编码透传、Response-like 组装、方法缺失抛错
- [x] provider 单测：model 时请求体含 `model`+`input`；apiKey 时带 Bearer 头；transportResolver 首次解析缓存；缺省路径逐字节不变（现有测试不改动通过）
- [x] `AUTHORITY_DECLARED_PERMISSIONS` 含 `http:{fetch:true}`，负断言更新且通过
- [x] 设置面板三项在位（DOM 冒烟）且默认全关
- [x] 实机冒烟：authority 通道 GET `/version` 返回 200 + 版本 JSON（截图留证）
- [x] 全量 `node --test tests/*.test.mjs` 绿

## Notes

- 上游设计：09-25-authority-integration-design §4 方向 B（密钥边界已如实标注：非密钥保险箱）。
- 用户裁定：Phase 2 纳入（2026-09-25）。

## 验收补充（2026-09-25 实测）

- 「实机冒烟：authority 通道 GET /version 返回 200」**受环境限制改判**：本实例管理员策略封锁全部
  http.fetch 出网（含环回的 SSRF 硬规则）；冒烟取证确认适配器正确送达 SDK 授权层、拒绝路径正确熔断。
  放行 hostname 后无需改码即可出网（R1 适配器与 R2 provider 已就绪）。
