# 多树视图（跨角色/群组同屏）设计

> 状态：**待用户裁定**（2026-09-26 出稿）。本文档只设计，不含产品代码改动。
> 结论先行：**技术上可行且与现有架构兼容**——数据面与构建面几乎全部复用，风险集中在
> 节点 id 冲突、性能预算与 index.js 单例渲染态三个点，均有可测的解法（见 §3/§4/§5）。
> 文末 §8 列出需要你裁定的决策点（各带推荐）。

---

## 1. 现状取证（单树管线的架构事实）

单树管线的完整链路与多树相关的关键事实如下（file:line 均为当前 `codex-luker-chinese-refactor` 分支实况）：

| # | 事实 | 证据 | 对多树的含义 |
|---|------|------|------------|
| F1 | 一次渲染只消费**一个**上下文：`getTimelinesContext()` 取 Luker/ST 全局 context，`makeContextKey` 用 `characterId/groupId/chatId/chatLength/lastMessageText` 定义"当前树"身份 | index.js:196-198、index.js:2150-2152；src/helpers.js:36-44 | 多树 = 同时持有 N 个上下文的数据快照；`makeContextKey` 本身可复用为每棵树的 key 生成器 |
| F2 | 数据获取按角色走 `fetchData(context.characters[context.characterId].avatar)`，返回 `{file_name: messages[]}` 全部会话；群组走 `group.chats` 列表 | index.js:2192、index.js:2175-2184；src/node-data.js:51 | 多角色 = N 次 `fetchData(avatar)`，天然可并行（并发受 memory-profile 分档约束，桌面 8 / 移动 4） |
| F3 | 构建面是纯函数链：`prepareDataProgressive` → `preprocessChatSessions`（跨会话转置）→ `buildGraph(allChats, …)` → `convertToCytoscapeElements` | index.js:2178/2196；src/node-data.js:192；src/graph-builder.js:12/66/387 | 构建面**与"当前上下文"无耦合**，逐树独立调用即可复用；L1-MF-11"纯函数可单测"已满足 |
| F4 | **节点 id 是构建期全局计数器**：`const nodeId = \`message${keyCounter}\`` | src/graph-builder.js:112 | ⚠ 多树同屏必冲突——两棵树各自从 `message0` 起数。必须命名空间化（§3.1） |
| F5 | 边收敛逻辑按**消息内容归组**（`groupMessagesByContent`：不同会话文件中同文本消息合流到同节点，形成分支结构） | src/graph-builder.js:39 | ⚠ 归组不能跨角色——不同角色出现相同文本（如"嗯。"）绝不可合流，否则两棵树被假边缝合。命名空间化须同时作用于**内容归组键**（§3.1） |
| F6 | 缓存已天然按角色/群组隔离：`scopeKey::fileName`，`scopeKey = 角色或群组标识` | src/cache.js:80-87 | 多树**零缓存改动**，N 棵树的会话缓存互不干扰 |
| F7 | 语义索引/检索 namespace 已按 `char_<id>` / `group_<id>` 隔离；A3 全局检索（scope 参数 + namespaceLabel 来源徽标 + 分组渲染）与 D1 全库聚合（`aggregateIndexStateByNamespace`）是仓内**现成的跨角色先例** | index.js:222-227；src/semantic-search-service.js:263；src/semantic-global-modal.js:39/66-79；src/semantic-index-service.js:650 | 多树的"每棵树归属哪个角色"徽标可复用 A3 的 namespaceLabel 模式；语义能力**无需为多树改一行** |
| F8 | 布局走 LayoutService：Web Worker + Dagre，消息式异步调用，Worker 不可用时自动降级主线程 | src/layout-service.js:1-45；src/layout.worker.js | 逐树布局可复用同一 Worker（串行排队或按树分批），满足 L1-MF-11"禁止主线程同步 Dagre" |
| F9 | 单树渲染态收敛在 index.js 模块级单例：`lastTimelineData / lastContextKey / theCy / progressiveGeneration / expandedClusterIds` | index.js:174-183 | ⚠ 多树不能直接复用这套单例语义（lastContextKey 只描述一棵树）；需要明确多树视图与单树视图的**状态边界**（§5） |
| F10 | LOD 抽稀/集群折叠已有机制（`expandedClusterIds`、`isLodCollapsedActive`、设备画像分档 `detectDeviceProfile`） | index.js:182-183；src/memory-profile.js:46 | 多树默认按设备档位限制同屏树数并默认折叠（§6） |

---

## 2. 目标与非目标

**目标（In Scope）**

- 在同一时间线画布中同屏渲染多棵时间树（≥2 个角色，或角色 + 群组混合），每棵树保持现有单树的完整交互语义（节点详情、路径回溯、书签/里程碑标识、当前会话节点定位）。
- 树与树之间视觉可辨（来源徽标/配色），支持从多树中任一节点跳转到对应角色的对应会话楼层。
- 单树路径**零回归**（现有 10 步 E2E 与 147 单测为基线）。

**非目标（Out of Scope，防蔓延）**

- ❌ 跨角色的"消息级"边（角色 A 的某句话"回应"角色 B 的某句话）——数据上不存在这种原生关系，编造即违反 L1-MF-4"原生数据源唯一"。多树中树与树**没有边**，只有空间拼装。
- ❌ 跨树全局统一力导布局（把 N 棵树当一个图布局）——收益存疑、成本高、且破坏树形可读性（见 §4 取舍）。
- ❌ 群组内部结构的多层级展开——群组在多树中就是"一棵树"（复用 F2 群组数据路径）。
- ❌ 语义索引/检索的任何改动（F7：namespace 天然隔离）。

---

## 3. 方案设计

### 3.1 节点 id 与内容归组键的命名空间化（核心，对应 F4/F5）

新增纯函数模块 `src/multi-tree.js`（名字暂定），提供**树命名空间包装器**：

```js
// 伪代码：多树构建的隔离层
buildTreeInScope({ treeId, fetchDataFn, memoryProfile }) {
  // 1) 以 treeId 为前缀构造"作用域化"的 channelHistory：
  //    每个会话文件的 key 从 `<chatName>` 变为 `${treeId}::<chatName>`
  // 2) 前缀同时进入 groupMessagesByContent 的归组键——
  //    内容归组只在同一 treeId 内发生（阻断 F5 的跨树假合流）
  // 3) buildGraph 产出的 nodeId `messageN` 在**出栈时**统一重写为
  //    `${treeId}::messageN`（重写为纯函数 mapNodeIdScope，可单测）
  return { treeId, elements, treeMeta };
}
```

要点：

- **不动 `buildGraph` 内部**——在其上游用前缀化的会话文件名隔离归组键，在其下游用 `mapNodeIdScope` 批量重写 id。两个纯函数（前缀包装、id 重写）都 100% Node 单测，`buildGraph` 单树行为零改动。
- Cytoscape 元素的 `data.id / data.source / data.target`、LOD 集群 id、父节点预索引映射（L1-MF-11）同步走 `mapNodeIdScope`，杜绝遗漏。
- `treeId` 采用与语义 namespace 同构的形态：`char_<characterId>` / `group_<groupId>`（对齐 F7），来源徽标直接复用 A3 的 `namespaceLabel` 渲染样式（semantic-global-modal.js:39 的 `📦` 徽标模式）。

**备选**：给 `buildGraph` 加 `options.idPrefix` 参数侵入式改造。**弃用理由**：改公开纯函数签名波及所有现存单测与单树调用点，收益只是省一层包装——不符合"单树零回归"目标。

### 3.2 数据聚合（对应 F2/F6）

- 树集合 = 用户选定的 N 个目标（角色或群组，见 §8-D1）。
- 逐目标取数：角色 `fetchData(characters[i].avatar)`；群组走 `group.chats` 组装同样的 `{file_name: messages}` 字典——两条路径在 `updateTimelineDataIfNeeded`（index.js:2165-2202）中本就并存，多树聚合器按目标类型分派即可。
- 并发与渐进：复用 memory-profile 的并发档位（桌面 8 / 移动 4），**逐树串行提交渲染**（首树=当前上下文优先，后续树后台批次补入，复用现有 onBatch/onProgress 渐进管线），保证"点开多树 1 秒内先看到当前树"。
- 缓存零改动（F6）。

### 3.3 布局拼装（对应 F8）

推荐 **"树内 Dagre + 树间网格平移"**：

1. 每棵树独立走 LayoutService（同一 Worker 内排队执行，保留 Worker 自动降级语义，F8）。
2. 拿到各树布局坐标后，由纯函数 `composeMultiTreeLayout(trees, {columns})` 计算每棵树的**平移向量**，按网格分区拼装（如 2×2），并输出全图 bounding box 供视口初始缩放。
3. 拼装参数确定性：同输入永远同输出（可单测，满足 L1-MF-11"纯函数模块"）。

**备选 A**：全图统一 Dagre（N 棵树合成一个大图跑一次布局）。**弃用理由**：树间无边（§2 非目标），统一布局只会把树"搅"在一起，可读性差；且节点总数叠加后布局耗时超预算。
**备选 B**：每棵树一个独立 Cytoscape 实例分屏。**弃用理由**：见 §5（minimap/雷达/高亮/上下文菜单全部要 N 份，状态同步成本高）。

### 3.4 交互映射

- 节点点击：从节点 id 前缀解析 treeId → 该树的角色/群组 + 该节点的 chatFile/messageId → 楼层穿越（复用现有单树的跳转逻辑；宿主 API 语义已实证：`selectCharacterById` 选角色 + `openCharacterChat(chatName)`，见 2026-09-26 E2E 修复取证）。
- 当前会话节点高亮（`zoomToCurrentChatNode`）只在**当前上下文对应的那棵树**生效，其余树静态展示。
- 搜索雷达：多树模式下跨树检索定位（雷达本就有跨会话徽章先例）。

---

## 4. 性能预算（L1-MF-11 硬约束的落实）

| 档位（memory-profile） | 同屏树数上限 | 单树节点预算 | 超限策略 |
|------------------------|------------|------------|---------|
| 桌面（desktop） | 4 | 沿用单树现有 LOD 阈值 | 第 5 棵起提示并拒绝加入 |
| 移动（mobile） | 2 | 同上 | 超限提示 |

- 布局全程 Worker（F8），主线程只有逐树的增量补丁渲染（复用现有渐进管线，P-8 的 rAF 合帧纪律同样适用）。
- 所有跨树聚合量（总节点数、总边数）由纯函数计算，超预算在**取数前**拒绝，而不是渲染后降级。
- 关键节点保护不变量（根/分叉/叶子/书签/里程碑/当前活跃）**在每棵树内**独立成立——多树拼装只是坐标平移，不触碰树内拓扑，不变量测试可直接参数化跑 N 棵树。

---

## 5. 渲染容器与状态边界（对应 F9）

**推荐：单 Cytoscape 实例 + 多树元素混挂**。所有元素平铺在同一 `cy` 中，树与树之间用坐标分区（§3.3）与 `treeId` 数据字段区分。理由：

- minimap、搜索雷达、高亮、上下文菜单、A1/A2/A3 语义芯片等现有能力全部锚定单实例，多实例方案要 N 份复制与跨实例状态同步，成本最高。
- index.js 的单例渲染态（`theCy`、progressiveGeneration 等）继续成立——多树视图**复用同一画布**，只是元素集合变成了 N 棵树的并集。

**多树模式的进入/退出**：多树是单树的一个**模式**，不是并列的第二套视图。进入多树时由多树编排器接管元素构建（调 §3.1 的作用域化构建）；退出时恢复单树管线原状。`lastTimelineData` 在多树模式持有的是"多树快照"（结构见 §3.2 返回值），`lastContextKey` 追加 `mode: 'multi'` 维度——这样 CHAT_CHANGED 等失效事件的现有接线（index.js:1980-1998）在多树下语义保持正确（当前上下文变了 → 失效重建）。

---

## 6. UI 入口

- 工具栏新增「多树」按钮（时间线模态内，与导出/大纲按钮同级，index.js:1693-1697 同级挂点）。
- 点击弹出目标选择器：角色多选列表（默认勾选当前角色；展示每个目标的消息量与缓存状态）→ 确认后进入多树模式。
- 多树模式下顶部显示模式横幅（当前树集合 + 退出按钮）。

---

## 7. 测试与验收基线

- **单测（新增，全纯函数）**：`tests/multi-tree.test.mjs`——① 归组键隔离（两树同文本不合流）；② `mapNodeIdScope` 重写完整性（id/source/target/父映射全覆盖，无遗漏字符）；③ `composeMultiTreeLayout` 确定性 + 网格无重叠（bounding box 两两不相交）；④ 预算超限拒绝；⑤ 关键节点不变量参数化 × N 树。
- **零回归基线**：`node --test tests/*.test.mjs` 147/147（现基线）+ 新增用例；`BASE_URL=https://127.0.0.1:8003 node tests/e2e/phase0-authority.mjs` 10/10（2026-09-26 扩展后基线）。
- **E2E 增补（实施任务内）**：多树模式进入 → 2 棵树元素共存（两 treeId 前缀各 ≥1 节点）→ 树间无跨树边 → 退出恢复单树。

---

## 8. 用户决策点（需裁定后才可写实施 PRD）

| # | 决策点 | 选项 | 推荐 | 理由 |
|---|--------|------|------|------|
| D1 | **选树来源** | a. 手选角色多选器（默认勾当前）<br>b. 全部有会话的角色自动载入<br>c. 收藏/置顶角色 | **a** | b 在角色多的实例下必然超预算（§4）；c 依赖收藏数据面，首版偏重。手选最符合"对比某几个角色"的真实场景 |
| D2 | **布局拼装** | a. 树内 Dagre + 树间网格平移<br>b. 全图统一 Dagre | **a** | 见 §3.3 取舍：确定性、可单测、可读性好 |
| D3 | **渲染容器** | a. 单 cy 实例混挂<br>b. 多实例分屏 | **a** | 见 §5：现有交互面全部锚定单实例 |
| D4 | **多树缺省折叠态** | a. 默认 LOD 折叠（集群节点入场）<br>b. 默认全展开 | **a** | 与单树的省内存档位语义一致；移动端几乎是必选 |
| D5 | **首版是否含群组树** | a. 仅角色<br>b. 角色+群组 | **b** | 群组数据路径现成（F2），增量成本低；若求最小首版可 a，但建议 b |

---

## 9. 工作量预估（供裁定参考）

- 纯函数模块 + 单测：`multi-tree.js` 三块（作用域包装 / id 重写 / 拼装）≈ 中等。
- index.js 编排层（模式切换、目标选择器 UI、渐进管线多树化）：**本次设计的主要成本**，因为要小心不破坏 F9 单例语义。
- E2E 增补与实机验证：沿用现成 CDP 框架，成本低。
