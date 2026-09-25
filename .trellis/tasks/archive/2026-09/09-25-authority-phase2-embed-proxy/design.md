# 实施设计：embedding 服务端代理

## 数据流

```
[开关开 + Authority ready]
provider.embedSingle(text)
  → body = model ? {text, model, input:[text]} : {text}
  → headers = {Content-Type, ...(apiKey ? Authorization: Bearer <key> : {}), ...getHeaders()}
  → fetchImpl = transportResolver() → createAuthorityHttpFetchAdapter(client)
      → client.http.fetch({url, method:'POST', headers, body: JSON.stringify(...), bodyEncoding:'utf8'})
      → [服务端按 hostname 授权 + 出网 + 审计]
      → {status, ok, body, bodyEncoding, contentType}
      → Response-like {ok, status, json(), text()}
  → 解析 {embedding} | {data:[{embedding}]}（既有逻辑不变）
```

## 关键点

1. **适配器（src/authority-http-fetch.js）**：无 DOM 无宿主依赖；`ensurePermission` 由 SDK client 内部完成（按 hostname 提示/授权）。`bodyEncoding` 固定 utf8（JSON 文本）。响应 body 为字符串，`json()` 尝试 JSON.parse，失败抛错（与浏览器行为一致）。
2. **transportResolver**：provider 构造时注入 `async () => fetchImpl`；embedSingle 首次 await 解析后缓存到实例。resolver 抛错（Authority 未就绪）→ EmbeddingUnavailableError（熔断路径复用）。
3. **index.js 组装**：`getSemanticProvider()` 构造参数按设置展开——开关开且 authority ready 时注入 resolver；开但未 ready → 不注入并 toastr.warn 一次。
4. **权限**：`http:{fetch:true}` 是 boolean 全量声明（hostname 授权在运行时逐 host 弹出/按默认策略 granted）。负断言测试改为「含 http.fetch、不含 storage.kv/jobs.background/fs/agent」。
5. **密钥**：`semanticHttpKey` 存宿主 extension_settings（与宿主其他密钥同安全域）；不做 Authority 侧保管（http.fetch 无此能力，如实标注）。

## 测试

- 单测：适配器翻译/组装/缺方法；provider 请求形状/头/resolver 缓存/缺省不变。
- 实机冒烟：GET `/version` 经 authority 通道（hostname 127.0.0.1）。
