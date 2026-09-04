# Timeline Performance Overhaul - Technical Design

## 1. 架构总览 (Architecture Overview)

本项目针对 SillyTavern-Timelines 扩展在多聊天分支（50+ 分支）与大 JSONL 文件（含长文本及大量 swipes）下的性能瓶颈进行系统性重构。核心架构分为四层：

```
┌─────────────────────────────────────────────────────────┐
│                    UI & View Layer                      │
│  - Settings Cache Panel (统计/清理)                       │
│  - Timeline Viewport (Cytoscape + Preset Layout)        │
│  - Search Input with Debounce (250ms)                   │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│              Graph & Render Pipeline Layer              │
│  - Style System: Class-based (data-bound) Styles        │
│  - O(1) Path Tracing: Map-indexed highlightPathToRoot   │
│  - Strict Deduplication (1:1 node & edge topology)      │
└────────────────────────────┬────────────────────────────┘
                             │ (Worker Message)
┌────────────────────────────▼────────────────────────────┐
│             Layout Engine Layer (Web Worker)            │
│  - Dagre Layout in Background Worker Thread             │
│  - Computes (x, y) coordinates asynchronously           │
│  - Main thread remains responsive with Loading indicator│
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│              Data & Storage Cache Layer                 │
│  - IndexedDB Store (`st_timelines_cache_v1`)            │
│  - Incremental Sync: fetch only changed/active chats   │
│  - Skeleton Extraction & Lazy Text Resolution           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 模块详细设计 (Detailed Module Design)

### 2.1 数据缓存层 (`src/cache.js` + `src/node-data.js`)

#### 数据库设计 (IndexedDB: `st_timelines_cache_v1`)
- **Store `chat_cache`**:
  - `keyPath`: `storageKey` (`${characterId || 'group'}:${fileName}`)
  - 索引：`characterId`、`updatedAt`
  - 存储对象：
    ```javascript
    {
      storageKey: string,
      characterId: string,
      fileName: string,
      fileSize?: number,
      lastModified?: number,
      messageCount: number,
      lastMessageText: string,
      lastMessageDate: string,
      messages: Array<MessageSkeleton>, // 消息骨架与完整正文
      cachedAt: number
    }
    ```
- **Store `character_meta`**:
  - `keyPath`: `characterId`
  - 记录角色上次同步完成时间、文件哈希及文件列表快照。

#### 增量加载机制
1. 调用 `/api/characters/chats` 获取该角色的所有聊天文件元数据列表 `serverChatList`。
2. 从 IndexedDB 批量读取该角色已缓存的元数据字典 `cachedMetaMap`。
3. 差异比对：
   - **新增/修改文件**：在 `cachedMetaMap` 中不存在，或是当前正在聊天的活跃会话（Active Session）-> 发起网络请求加载。
   - **未变文件**：直接命中本地 IndexedDB，跳过网络请求。
   - **已删除文件**：从 IndexedDB 中清理。
4. 加载完成后，将新拉取的文件异步写入 IndexedDB。
5. 收益：二次打开时间线时，网络请求数由 $N$ 降至 $1$（仅当前活跃文件）或 $0$。

---

### 2.2 图数据精简与算法优化 (`src/node-data.js` & `src/style.js`)

#### 消除重复节点与边 (Deduplication)
- **现有缺陷分析**：
  在 `buildGraph` 中，`for (const messageObj of group)` 循环体内错误地调用了 `cyElements.push({ group: 'nodes', data: node })`，导致同一深度相同内容的节点被重复推入多次（等于使用该消息的分支数）；同时边也被多次重复推入。
- **修复方案**：
  - 节点仅在外层循环按唯一 `nodeId` 推入一次。
  - 边采用 `Set<string>` 维护 `edgeKey = `${parentNodeId}->${nodeId}``，确保图拓扑为严格精简的 DAG。

#### O(1) 路径高亮索引 (`src/style.js`)
- **现有缺陷分析**：
  `highlightPathToRoot` 在 `while (currentNode)` 循环中，每次向上回溯都通过 `Object.values(rawData).find(...)` 线性扫描全图所有节点和边，综合复杂度为 $O(\text{Bookmarks} \times \text{Depth} \times \text{Elements})$。
- **重构方案**：
  - 在遍历高亮前，单次扫描建立两个哈希映射：
    - `nodeMap = new Map<nodeId, nodeElement>()`
    - `incomingEdgeMap = new Map<targetId, edgeElement>()`
  - 回溯过程直接通过 `incomingEdgeMap.get(currentNode.data.id)` 与 `nodeMap.get(edge.data.source)` 检索，复杂度降为 $O(\text{Bookmarks} \times \text{Depth})$，速度提升百倍以上。

---

### 2.3 渲染管线与样式重构 (`src/style.js` & `index.js`)

#### 样式类化 (Class-based Styling)
- 废除在 Cytoscape 样式表中为每个元素执行 JS 函数计算属性的做法。
- 采用 Class 结合 `data(...)` 属性映射：
  - 节点类：`.is-user`, `.is-char`, `.is-bookmark`, `.has-swipes`
  - 边类：`.is-highlighted`, `.is-normal`
  - 颜色/尺寸直接通过 `data(color)`、`data(borderColor)`、`data(width)` 等属性取值，让 Cytoscape 的 Canvas 渲染器走内部快速批处理管线。

#### 视口渲染加速
- 在 Cytoscape 初始化中开启：
  - `textureOnViewport: true`：拖拽和平移视口时使用纹理快照，显著提升平移帧率。
  - `hideEdgesOnViewport: true`：在大图视口缩放平移时临时隐藏细边，大幅减少绘制负担。
  - `pixelRatio: 'auto'`：适配高分屏同时控制显存开销。

#### 搜索防抖
- 对 `#textSearchElement` 增加 `debounce(performTextSearch, 250)`，彻底消除每敲击一个字母引发的全图重新高亮与缩放动画。

---

### 2.4 Dagre 布局异步化 (Web Worker: `src/layout.worker.js`)

#### 为什么使用 Web Worker
- Dagre 是 CPU 密集型布局算法（Rank 分层、交叉最小化、坐标分配），在 500+ 节点以上时通常阻塞主线程 500ms~2500ms，导致浏览器出现“页面无响应”警告。

#### 协议与流程
1. 主线程将拓扑结构序列化为纯数据传输给 Worker：
   ```javascript
   worker.postMessage({
     type: 'LAYOUT_REQUEST',
     nodes: nodes.map(n => ({ id: n.data.id, width: n.data.width, height: n.data.height })),
     edges: edges.map(e => ({ id: e.data.id, source: e.data.source, target: e.data.target })),
     layoutOptions: { rankDir, nodeSep, rankSep, ... }
   });
   ```
2. Worker 内部引入并运行 `dagre.js`，计算所有节点的 `(x, y)` 坐标。
3. Worker 计算完成后，返回位置映射字典 `{ [id]: { x, y } }`。
4. 主线程接收到消息，调用 Cytoscape 的 `preset` 布局瞬间就位：
   ```javascript
   cy.layout({
     name: 'preset',
     positions: (node) => positions[node.id()],
     fit: true,
     padding: 50
   }).run();
   ```
5. 降级容错：如果运行环境不支持 Worker，自动无缝回退到主线程 Dagre 布局。

---

### 2.5 用户控制面板 (`settings.html` & `index.js`)
- 在扩展设置面板中添加「时间线性能与缓存」区块：
  - 显示当前缓存文件数与估算占用存储（MB）。
  - 「强制刷新」按钮：清理当前角色的缓存并重新拉取。
  - 「清空所有缓存」按钮：清空整个 IndexedDB 数据库。
