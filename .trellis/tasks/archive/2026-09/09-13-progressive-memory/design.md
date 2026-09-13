# 技术设计：渐进式渲染与内存极压

## 1. 管线总览

```
onTimelineButtonClick(forceReload)
  ├─ vendor 检查（失败 → toastr，退出）
  ├─ handleModalDisplay()                  ← F1 画布先行，无全屏 loader
  ├─ renderCytoscapeDiagram([], layout)    ← 空画布骨架 + 挂载进度条
  ├─ progress.start()
  ├─ fetchChatList            progress: 'list'    （5%）
  ├─ prepareDataProgressive   progress: 'load'    （5%→75%，逐文件）
  │    每文件 onBatch → 节流(600ms) rebuild：
  │      convertToCytoscapeElements(dict, profile)
  │      → diffCytoscapeElements(prev, next)         [纯函数]
  │      → applyElementPatch(theCy, diff)            [只增改，不重建]
  │      → 异步 worker 布局定位新节点（代际守卫） progress: 'build'（75%→90%）
  ├─ refreshDiagram(finalElements, fit=true)  ← 既有路径：LOD + dagre + fit
  │                                            progress: 'layout'（90%→99%）
  └─ progress.done() + zoomToCurrentChatNode          （100%，自动淡出）
```

## 2. 新模块契约

### 2.1 `src/memory-profile.js`（纯逻辑，可测）

```js
export function detectDeviceProfile({ navigatorOverride = null, mode = 'auto' })
  // mode: 'auto' | 'on' | 'off'（设置项 memory_saver_mode）
  // auto 判定: (deviceMemory && deviceMemory <= 4) || hardwareConcurrency <= 4 || coarse pointer
  // -> { memorySaver: boolean, maxPreviewChars: 160|240, fetchConcurrency: 4|8, reason: string }
export function truncateForNode(text, maxChars)
  // -> { text, truncated } ；换行折叠、null 安全、maxChars 下限 40
```

### 2.2 `src/incremental-merge.js`（diff 纯函数 + cy 应用）

```js
export function diffCytoscapeElements(prevElements, nextElements)
  // 按 data.id 对齐；data 用稳定序列化比较（键序归一）
  // -> { added: [...], updated: [...], removed: [...] }
export function applyElementPatch(cy, diff)
  // cy.batch 内：removed→remove，added→add，updated→ele.data(next.data)
export function assignProgressivePositions(addedElements, cy)
  // 渐进期兜底定位：父节点位置 + 网格偏移（worker 布局未就绪时防堆叠）
```

### 2.3 `src/load-progress.js`（状态机纯逻辑 + DOM 组件）

```js
// 纯状态机（可测）
export function createProgressState()
  // set(phase, {done, total, detail}) / done() / fail(err) / get() / subscribe(fn)
  // 阶段权重: list 5 / load 60 / cache 60 / build 15 / layout 15 / done 100
  // 百分比 = 已完成阶段权重和 + 当前阶段内部进度 × 阶段权重；单调不回退、钳位 [0,100]
export const PROGRESS_PHASES   // 阶段文案表（中文，含 detail 格式化）
// DOM 组件（浏览器）
export function mountProgressOverlay(container)
  // -> { update(state), finish(), fail(msg), destroy() }
  // 顶部固定胶囊：spinner + 阶段文本 + detail + 进度条；完成 1.2s 后淡出；失败红色常驻直到重开
```

### 2.4 `node-data.js` 增量管线（保持旧 API）

```js
export async function prepareDataProgressive(data, isGroupChat, {
  forceReload = false, concurrency = null,     // null → profile 决定
  onBatch = null,      // (fileName, messages) => void  单文件粒度
  onProgress = null,   // (phase, {done, total, detail}) => void
  signal = null,       // AbortSignal（可选）
})
// 流程同 prepareData，但：
//  - 活跃会话最先入批（先渲染当前分支）
//  - 缓存命中分块（每 8 个文件一 tick）逐批回调 + yield 让出主线程
//  - 网络文件每完成一个立即 onBatch + onProgress('load', {detail: file_name})
//  - 返回值仍为最终 cytoscape elements（兼容）
export async function prepareData(data, isGroupChat, forceReload)  // 包装新管线
```

### 2.5 `graph-builder.js` 内存档位穿透

- `convertToCytoscapeElements(chatHistory, memoryProfile = null)` → `buildGraph(allChats, lengths, memoryProfile)` → `createNode(..., memoryProfile)`。
- profile 非空时：`msg` = `truncateForNode(text, maxPreviewChars)` 截断 + `msgTruncated` 标记；swipe 节点同规则。
- **默认 null：输出与现状完全一致**（现有测试即回归保证）。

### 2.6 `node-data.js` 全文按需解析

```js
export async function getFullNodeText(nodeData)
  // msgTruncated 时：chat_sessions 第一项 (file, index) → timelinesCache.getChat → messages[index].mes
  // 未截断直接返回 msg
```

## 3. index.js 编排改造（最小侵入）

1. `layout = {...}` 配置生成提取为 `buildLayoutConfig()`（原 updateTimelineDataIfNeeded 内联段复用）。
2. `updateTimelineDataIfNeeded(forceReload, hooks = {})` 增加可选 hooks `{onBatchDrivenRebuild, onProgress, memoryProfile}`：有 hooks 走渐进管线（内部调 prepareDataProgressive + 节流 rebuild + patch + worker 布局代际守卫），无 hooks 行为与现状一致（一次构建）。group/单人两分支逻辑保持。
3. `onTimelineButtonClick`：按 §1 管线重排——画布先行、移除数据期 `showLoader`、空图初始化、渐进 hooks、收尾 `refreshDiagram(lastTimelineData, true)` + `zoomToCurrentChatNode`。非更新路径（contextKey 未变且已有 cy）保持秒开逻辑。
4. TapTippy 卡片（index.js:792 区）：`msgTruncated` 时追加「全文已截断，可跳转会话查看」提示行。
5. 设置：`memory_saver_mode: 'auto'`（settings.html 下拉 + loadSettings + idsToSettingsMap）；memoryProfile 会话级缓存，构建时求值。

## 4. 关键决策与权衡

- **每批全量 rebuild + id diff**（而非真增量图算法）：buildGraph 输入前缀确定性保证 id 稳定；O(批 × N) 在节流（600ms）下可接受，换取正确性与极小 diff 面积。真增量合并算法复杂度不划算。
- **渐进期不做 LOD、用 worker 布局定位**：LOD 折叠会与增量添加相互干扰；worker 布局非阻塞且有代际守卫丢弃过期结果。
- **全文仍存 IndexedDB**：细腰图只削"驻留内存"，持久层不动——全文按需解析有现成来源，零迁移。
- **进度百分比用阶段权重混合**：单阶段 done/total 真实可靠，跨阶段权重视觉平滑；状态机保证单调。

## 5. 兼容与回滚

- `prepareData` 旧签名保留；graph-builder 默认参数输出逐字节一致（测试锁定）。
- 渐进失败（异常）→ progress.fail + 回退一次性 `refreshDiagram`（旧路径兜底）。
- 回滚 = revert 本次提交；无持久化格式变化。
