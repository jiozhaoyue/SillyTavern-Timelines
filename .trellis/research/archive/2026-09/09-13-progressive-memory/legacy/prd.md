# PRD：极端内存优化与渐进式渲染——画布先行 + 后台加载 + 全程进度

## Goal

手机等弱环境下打开时间线的体验重构：**点击即见画布**，JSONL 在后台分批加载并**逐批增量渲染**，全程**常驻进度条**实时显示当前正在处理的阶段与对象；配合「细腰图」（节点只存文本预览）与引用释放策略，极端压低内存峰值。

## 现状痛点（已勘探）

1. `onTimelineButtonClick`（index.js:2035）在 `showLoader()` 全屏遮罩下**同步等完全部数据**才开画布：N 个分支会话 × (HTTP 拉取 + 主线程 JSON 解析) 全部完成后才能看到任何图。
2. 节点 `msg` 存**全量消息文本**；每个 swipe 变体还各自复制一份全文（graph-builder.js:153-160）——千节点大图内存被文本吃掉一个量级。
3. 加载过程零反馈：只有全屏 loader，用户不知道在处理什么、还剩多少。
4. 每次重渲染 `renderCytoscapeDiagram` 整图销毁重建（index.js:1809-1825）。

## Requirements

### F1 画布先行（Canvas-first）
- 点击打开时间线：立即 `handleModalDisplay()` 打开视图并初始化空画布（root 骨架），全程不出现全屏 loader 遮罩等待数据（vendor 加载失败等致命错误除外）。

### F2 后台渐进加载（Background pipeline）
- 数据管线全部后台化：会话列表 → 缓存命中批 → 网络拉取批，按**单文件粒度**回调（`onBatch(file, messages)`），批间让出主线程（yield），移动端自动降低并发（8→4）。
- 保持旧 API `prepareData` 兼容（内部走新管线，行为不变）。

### F3 节点就绪即渲染（Incremental render）
- 每批数据到达后节流重建拓扑（默认 600ms 或收尾时），与当前已渲染元素做 **id 级 diff**，只 `cy.add` 新增、`data()` 更新变化项，不整图销毁重建。
- 渐进期新增节点用 Worker 布局结果定位（带代际守卫防竞态），最终完成时走既有 `refreshDiagram` 全量路径（LOD + dagre + fit）。

### F4 全程常驻进度条（Always-on progress）
- 画布顶部固定进度胶囊：阶段文本（获取会话列表 / 正在加载 x.jsonl (12/40) / 缓存命中 (30/40) / 构建拓扑 / 布局中）+ 确定性百分比进度条 + 完成后自动淡出，失败转红色错误态。
- 加载期间**任何时刻**可见（包括缓存命中路径），不得闪现即消失。

### F5 细腰图内存极压（Thin-node memory saver）
- 设备画像自动判定（deviceMemory/hardwareConcurrency/触屏）：弱设备自动开启省内存模式，设置可强制 on/off/auto（默认 auto）。
- 省内存模式：节点 `msg` 与 swipe 文本截断为预览（移动 160 字 / 桌面 240 字），打 `msgTruncated` 标记；卡片对截断节点显示「已截断」提示；导出 `getFullNodeText` 按需解析全文（cache → chatFile+index）。
- 加载收尾后释放构建期临时引用（聊天字典、转置结构）；现有非省内存模式行为 100% 不变（默认参数下 graph-builder 输出与现在逐字节一致）。

## 非目标

- 不改语义检索（上一任务）行为；不改 LOD 折叠算法本身；不做虚拟化渲染（视口剔除）——LOD 已覆盖。
- 不改缓存持久化格式（IndexedDB 仍存全量消息——它本来就是全文的按需来源）。

## Acceptance Criteria

- [ ] 打开时间线立即出现画布与进度条，数据后台加载；全程进度条可见且实时更新阶段文案（列出当前处理的文件名）。
- [ ] 节点随批次增量出现（不整图重建），最终与一次性加载的拓扑一致（diff 单测保证 id 稳定与更新正确）。
- [ ] 省内存模式下 `msg` 为预览 + `msgTruncated` 标记；默认模式下 graph-builder 输出与现状完全一致；弱设备画像自动判定正确。
- [ ] `node --test tests/*.test.mjs` 全绿（新增 load-progress / memory-profile / incremental-merge 三个测试文件），既有 100 用例零回归。
- [ ] 全部改动文件 `node --check` 通过。
