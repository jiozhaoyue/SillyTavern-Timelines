# 执行计划：渐进式渲染与内存极压

> 前置：prd.md / design.md。实现模式：inline（子代理通道不可用）。硬约束：graph-builder 默认参数输出不变；`node --test` 全绿；不 commit。

## 阶段 A：纯逻辑模块 + 测试

- [x] A1 `src/memory-profile.js`：`detectDeviceProfile`（auto/on/off；deviceMemory≤4 / hwConcurrency≤4 / coarse pointer 判定；160/240 预览、4/8 并发）+ `truncateForNode`（换行折叠、null 安全、下限 40）
- [x] A2 `tests/memory-profile.test.mjs`：弱/强设备画像、强制开关、截断边界（空串/CJK/恰好在限/超限/换行）
- [x] A3 `src/load-progress.js` 纯状态机：`createProgressState`（阶段权重混合百分比、单调钳位、done/fail、subscribe）+ `PROGRESS_PHASES` 文案表
- [x] A4 `tests/load-progress.test.mjs`：百分比计算（load 12/40 → 区间断言）、单调不回退、done=100、fail 态、订阅通知
- [x] A5 `src/incremental-merge.js`：`diffCytoscapeElements`（键序归一比较）、`applyElementPatch`（mock cy）、`assignProgressivePositions`
- [x] A6 `tests/incremental-merge.test.mjs`：新增/更新（chat_sessions 扩展、swipe 元数据）/删除三路径、id 对齐、patch 调用序、位置兜底

## 阶段 B：管线与构建器改造

- [x] B1 `src/node-data.js`：`prepareDataProgressive`（活跃会话先行、缓存分块 tick + yield、网络逐文件 onBatch、onProgress、signal、concurrency 参数）+ `prepareData` 兼容包装 + `getFullNodeText`
- [x] B2 `src/graph-builder.js`：`memoryProfile` 穿透 convertToCytoscapeElements → buildGraph → createNode + swipe 节点；默认 null 输出不变
- [x] B3 既有测试回归：`node --test tests/graph-builder.test.mjs tests/cache.test.mjs` 绿

## 阶段 C：编排接线（index.js / settings / style）

- [x] C1 index.js：`buildLayoutConfig()` 提取；`updateTimelineDataIfNeeded(forceReload, hooks)` 渐进 hooks（节流 600ms rebuild + diff patch + worker 布局代际守卫 + progress 阶段上报）；无 hooks 行为不变
- [x] C2 index.js `onTimelineButtonClick` 重排：画布先行（handleModalDisplay 前置 + 空图初始化）、移除数据期 showLoader、渐进驱动、失败回退一次性渲染、收尾 refreshDiagram + zoomToCurrentChatNode
- [x] C3 TapTippy 截断提示（msgTruncated → 提示行）
- [x] C4 settings.html「省内存模式」下拉（auto/on/off）+ loadSettings + idsToSettingsMap；memoryProfile 会话级求值
- [x] C5 `src/load-progress.js` DOM 组件 `mountProgressOverlay` + style.css 进度胶囊样式（顶部固定、移动端适配、完成淡出、失败红态）

## 阶段 D：验证

- [x] D1 `node --test tests/*.test.mjs` 全绿（100 既有 + 新增）
- [x] D2 `node --check` 全部新增/修改 js 文件
- [ ] D3 手动验收清单输出（手机端步骤：打开即见画布+进度条 → 节点渐现 → 完成后布局定格）

## 回滚点

- 阶段 A/B 纯新增+参数穿透，回滚即删文件；C1/C2 为 index.js 集中改动点，可独立 revert。
