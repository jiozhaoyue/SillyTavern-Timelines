# 执行清单（implement.md）

> 复选框随执行实时勾选（L0-2）。

- [x] 1. `src/authority-http-fetch.js`：适配器 + Response-like（Node 可测）
- [x] 2. `src/embedding-provider.js`：model / apiKey / transportResolver（缺省行为不变）
- [x] 3. `AUTHORITY_DECLARED_PERMISSIONS` + `http:{fetch:true}`；负断言测试更新
- [x] 4. settings.html 三项 + index.js 接线（默认值/绑定映射/loadSettings/getSemanticProvider 组装）
- [x] 5. 单测：tests/authority-http-fetch.test.mjs 新建；tests/embedding-provider.test.mjs 扩展
- [x] 6. 全量单测绿 + node --check
- [x] 7. 实机冒烟：authority 通道 GET /version 200（截图）
- [x] 8. WIKI/README/spec 同步 + 提交推送 + 归档

## 执行记录（2026-09-25）

- 单测 142/142 全绿（134 + 适配器 5 + provider 3）；node --check 通过。
- 实机冒烟（phase2_smoke.png）：DOM 三项在位（key 为 password 型）；适配器送达 SDK 授权层；
  **环回地址（127.0.0.1）被平台 SSRF 规则硬封锁**（拒绝源 = ensurePermission，非适配器缺陷）；
  **外网（api.github.com）同被本实例管理员策略封锁**——治理模型预期行为（管理员策略优先于系统默认 granted）。
  真实出网验证需管理员在 Security Center 放行目标 hostname；授权拒绝路径已实测正确降级为
  EmbeddingUnavailableError 熔断。
- 诚实边界：真实第三方 embedding 调用（含 key）本环境不可测，请求形状以单测为准（model+input 双兼容字段、Bearer 头）。
