# Authority 集成 Phase 0 实机 E2E 与 Phase 1 零新权限检索深化

## Goal

Phase 0：对 Dev Luker 8003 + Authority 按 L1-MF-15 纪律做实机 E2E（语义索引→混合检索→跨会话穿越全链路与降级路径），宿主可用性结论回填 spec；Phase 1：零新权限实施 A2 雷达语义筛选接线 / A3 跨角色全局检索 / D1 跨角色统计物化 / A1 neighbors 语义上下文，单测全绿后经 git pull 部署复验

## Requirements

- **R1（Phase 0 E2E 纪律）**：E2E 脚本必须满足 L1-MF-15——启动即断言目标端口在 Dev 白名单（`{8001, 8003, 8899}`），`BASE_URL` 类变量无默认值（未设置即失败退出非 0）；只对 `Instance/Dev/**` 运行；禁止读取/遍历实例聊天内容。
- **R2（Phase 0 全链路验证）**：在 Dev Luker（`https://127.0.0.1:8003`，已确认 `plugins/authority` 服务端插件与 `st-authority-sdk` 扩展在位）验证：适配层 `ready`、语义索引构建（Trivium stat 增长 + index_state 登记）、`searchHybrid` 命中、雷达语义模式结果、跨会话弹窗与穿越、embedding 熔断降级路径。截图留证。
- **R3（Phase 0 结论回填）**：宿主可用性实证结论（Luker 可移植子集可用性）回填 `.trellis/spec/frontend/optional-integration.md`（spec 页自包含，L0-17）。
- **R4（Phase 1-A2）**：雷达语义模式支持按标签 / 书签筛选（`payloadFilter` 扩展，payload 字段已存在）；筛选器纯函数 Node 可测； Authority 未就绪时语义模式整体休眠（现状不变）。
- **R5（Phase 1-A3）**：跨角色全局检索开关（设置项，默认**当前角色**）：开启后 `payloadFilter` 不含 namespace；跨会话结果行显示来源 namespace（索引 payload 增补 `namespaceLabel`，旧条目回退显示键名）；结果按角色分组展示。
- **R6（Phase 1-D1）**：全景数据看板新增「全库聚合」区块：SQL 聚合 `index_state`（按 namespace 计数 + 最近索引时间），Authority 未就绪时隐藏该区块。
- **R7（Phase 1-A1）**：语义命中的节点可扩展 1 跳楼层上下文（`trivium.neighbors`，请求 `{database, id, depth}`，hit 自带内部 `id` 衔接）；特性检测用「方法存在性 + try/catch 降级」（`neighbors` 无独立特性旗标），失败只降级自身并提示，不波及词法检索。
- **R8（权限与边界不变量）**：全程零新增权限声明（`AUTHORITY_DECLARED_PERMISSIONS` 保持 `{trivium:{private:true}, sql:{private:true}}` 并有负断言测试）；所有新功能 absent 短路；原生 `message.extra` 仍是唯一事实源（L1-MF-4）；不改上游产物、不碰 Host Bridge（L0-12）。
- **R9（质量门）**：`node --test tests/*.test.mjs` 全量绿；新纯函数全部 Node 可测（禁静态导入宿主模块）；部署到实例只走 `git pull`（先推送 origin 再到实例目录 pull，L0-1/L0-7 合规），部署后复验 Phase 0 关键链路。

## Acceptance Criteria

- [x] E2E 脚本含启动断言：端口不在白名单 → 非 0 退出并打印「疑似误连 Real 实例」；`BASE_URL` 未设置 → 失败（实测 gate 生效）
- [x] Phase 0 实测通过：**8/8 断言全绿**（适配层 ready / Trivium 数据面往返 / SQL 状态面 / 构建链路优雅降级 / 跨会话弹窗渲染，截图 4 张）；宿主可用性结论已回填 spec。**偏差**：Luker fork 已移除 `/api/embeddings/compute`（宿主无原始向量化端点），「embedding→索引→检索」全链路在该宿主不可实测，以合成向量数据面往返 + 降级断言等价覆盖；该发现坐实 Phase 2 优先级
- [x] A2：雷达筛选面板书签/标签/说话人筛选与语义模式接线完成（服务端等值 + 客户端后过滤），单测覆盖 filter 构建/后过滤/topK 放大；实机 DOM 五组控件在位（语义检索端到端依赖 embedding 通道，宿主缺口如上）
- [x] A3：设置「跨角色全局检索」开关存在（默认关）；scope=global 不加 namespace 过滤有单测；结果来源徽标 + 分组渲染就绪；namespaceLabel 回退单测覆盖。**注**：设置持久化受实例保存链路缺失影响（环境基线，见 implement.md），会话内行为正常
- [x] D1：看板「全库语义索引聚合」区块 ready 时渲染真实聚合、无数据/失败时静默移除（实机 ok:true + 单测聚合逻辑）
- [x] A1：neighbors 上下文扩展（身份芯片 + 穿越）实现；桩掉 neighbors/抛错时降级为空上下文（单测）；实机确认 `trivium.neighbors` 方法存在
- [x] 全量单测绿：**134/134**（基线 124 + 新增 10）；`AUTHORITY_DECLARED_PERMISSIONS` 保持 `{trivium, sql}` 不变
- [x] 部署与复验：实例目录为指向本工作仓的 junction（部署零动作），Phase 0 E2E 重跑 8/8 零回归 + Phase 1 冒烟通过

## 附带产出（Phase 0 实机审计的直接结果）

- **生产级修复**：`semantic-index-service.js` 两处 `bulkDelete` 条目补 `namespace`——此前缺省落 `default` 命名空间报 "not mapped"，**增量清理从未真正删除过 Trivium 节点**（静默漏删）；附回归单测 + E2E 探针实证（删除后复查 gone=true、stat 归零）。

## Notes

- 设计依据：归档任务 `09-25-authority-integration-design/design.md`（能力面全景 §2、候选方向 §4、分期路线 §5）；本任务 PRD/design 自包含关键 DTO 事实。
- 环境事实（2026-09-25 现场取证）：Dev Luker `https://127.0.0.1:8003` 在线（HTTPS 302）；`plugins/authority`、`st-authority-sdk`、`data/_authority-global` 在位；Timelines 以 git clone（origin=jiozhaoyue/SillyTavern-Timelines）装于 `public/scripts/extensions/third-party/SillyTavern-Timelines`。
