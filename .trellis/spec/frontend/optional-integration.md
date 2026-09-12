# Optional Integration & Node-Testable Module Conventions

> 沉淀自任务 `09-12-authority-integration`（Authority 服务端集成）。适用于前端插件的第三方能力接入与纯逻辑模块设计。

---

## 1. 可选外部插件集成约定（Authority 范式）

当接入"可能不存在"的外部宿主能力（如 Authority 服务端插件的 `window.STAuthority`）时，必须遵循：

1. **能力嗅探 + 全空值防御**：所有探测点写成 `window.STAuthority?.AuthoritySDK`；模块级单例状态机（`absent / disabled / connecting / ready / error`）统一管理生命周期，禁止散落的布尔标记。
2. **零硬依赖**：未安装时全模块静默休眠（`absent` 短路），主链路零新增 console error、零 UI 空壳。UI 注入点必须容忍"就绪晚于 UI 创建"（有限次重试 + 单次状态订阅，禁止无界重试风暴；错误态冷却 60s）。
3. **最小权限声明**：只声明实际用到的权限（本插件：`trivium.private`、`sql.private`、`storage.kv`、`jobs.background`）；绝不顺手声明 `agent.*` / `fs.*` / `http.*`。
4. **派生数据唯一原则**：外部服务端只允许保存"可随时全量重建的派生投影"（向量索引、状态表）。原生 `message.extra` / `chat.jsonl` 永远是唯一数据源——卸载外部插件后插件功能必须完好。
5. **降级路径显式化**：任何集成失败（断网/拒权/维度切换）只降级该功能自身并向用户 toast 说明，绝不静默吞错、绝不波及词法检索等既有功能。

参考实现：`src/adapters/authority-adapter.js`（状态机）、`src/semantic-index-service.js`（派生索引）。

## 2. Node 可测模块约定（纯逻辑 / IO 分离）

前端插件目前没有构建步骤与打包器，测试用 `node --test`。要让模块能被 Node 直接导入：

1. **禁止静态导入宿主模块**：`script.js`、`extensions.js`、jQuery、`toastr` 等只能在 `index.js`（浏览器入口）导入；src 下的纯逻辑模块一律通过参数注入（如 `getHeaders`、`fetchImpl`、`client`、`provider`）。
2. **纯函数与 IO 编排分离**：同一文件内导出纯函数（编解码、diff、格式化、分块）+ IO 类/编排函数（注入依赖）。测试只打纯函数与注入桩。
3. **浏览器专用 DOM 模块**（如 `*-modal.js`）可自由用 DOM/jQuery，但要求 `typeof document === 'undefined'` 时安全短路，且不参与纯逻辑测试。
4. **确定性**：纯函数输入输出稳定可哈希（如 `hashText` FNV-1a）；需要"内容是否变化"判断时一律用内容指纹，而非时间戳。

---

**Language**: All documentation must be written in **English**. (实现层注释保持中文与现有代码一致；本 spec 面向 AI/开发者，正文可中文。)
