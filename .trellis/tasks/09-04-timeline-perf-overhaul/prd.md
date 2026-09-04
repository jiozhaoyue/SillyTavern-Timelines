# Timeline Performance Overhaul

## Goal

彻底解决 SillyTavern-Timelines 在拥有大量聊天分支（数十至数百个分支）以及超大 JSONL 文件（含长文本与大量 swipes）场景下的性能瓶颈。通过本地增量缓存、数据瘦身、算法索引化、渲染管线重构以及异步布局，消除页面假死，使秒级/亚秒级加载与丝滑时间线渲染成为常态。

## Requirements

### 1. 数据层：IndexedDB 增量持久化缓存与网络请求瘦身
- 建立浏览器端持久化数据库（IndexedDB，如 `st-timelines-cache`），存储各聊天文件的消息解析结果与特征签名。
- 差异化请求同步：通过文件更新时间戳或最后消息特征对比，仅拉取变更/新增的聊天文件，未变文件直接自本地读取。
- 提供缓存失效策略与一键清理/强制重载通道（支持 `/tl r` 强制刷新，处理分支删除或重命名）。

### 2. 内存与数据结构：拓扑骨架与长文本分离 + 消除冗余 Bug
- 修复 `src/node-data.js` 中在 `group` 遍历里重复推入相同 node 和 edge 的缺陷，实现节点和边的精确去重。
- 节点数据轻量化：Cytoscape 节点只挂载拓扑必要字段，完整正文和海量 swipes 实行按需懒加载或引用字典检索，大幅减轻内存负担。

### 3. 图算法重构：O(1) 路径寻路索引
- 重构 `src/style.js` 中的 `highlightPathToRoot`，将当前每步循环里的 `Object.values(rawData).find(...)` 全量扫描改为预构建的 `Map<id, element>` 索引，将检查点路径高亮计算复杂度由 $O(B \cdot D \cdot N)$ 骤降至 $O(B \cdot D)$。

### 4. 渲染管线与交互优化
- 样式类化：将 Cytoscape 中大量依靠 JS 动态函数求值的节点/边样式重构为 Class 类名与 `data(...)` 映射，启用内部渲染缓存。
- 开启视口激进裁剪配置（`textureOnViewport: true`、`hideEdgesOnViewport: true` 等），高分辨率或快速拖拽时保证帧率。
- 搜索防抖：对顶部全文检索输入添加防抖（250ms），避免高频全图重绘。

### 5. 布局异步化 (Web Worker)
- 将 CPU 密集的 Dagre 图层级布局计算移至 Web Worker 异步计算，主线程展示轻量进度条或骨架屏，计算完成后平滑呈现，彻底杜绝主线程卡死。

## Acceptance Criteria

- [ ] 面对 50+ 聊天分支时，二次加载时间降至 500ms 以内（IndexedDB 命中率 >90%）。
- [ ] 彻底修复相同消息节点与边的重复推入，Cytoscape element 数量与实际拓扑 1:1 严格对齐。
- [ ] `highlightPathToRoot` 执行时间在大图（>1000 节点）下降低至 5ms 以内。
- [ ] 连续键入搜索时不再卡顿，防抖生效且筛选准确。
- [ ] Dagre 布局执行期间主线程不假死，有流畅加载状态展示。
- [ ] 原有所有业务功能（跳转、分支创建、swipes 切换、检查点路径高亮、图例、右键菜单）保持 100% 兼容。
- [ ] Node.js 单元测试通过，并新增针对缓存层与图数据处理的测试覆盖。
