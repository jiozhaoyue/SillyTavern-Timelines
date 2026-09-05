# Design: 超大时间树 LOD 分层抽稀与动态视口性能优化

## 1. 架构总览 (Architecture Overview)

```
                       [ Native ST Chat JSONL Files ]
                                      │
                                      ▼
                        [ preprocessChatSessions ]
                                      │
                                      ▼
                             [ buildGraph ]
                                      │
                                      ▼
                              Raw Full Elements
                                      │
                                      ▼
                     ┌──────────────────────────────────┐
                     │    src/lod-service.js            │
                     │  - findCollapsibleChains         │
                     │  - applyLodToElements            │
                     │  - 保护集过滤 (分叉/叶子/记忆/书签)│
                     └──────────────────────────────────┘
                                      │
                                      ▼
                           LOD Decimated Elements
                                      │
                                      ▼
                        [ Cytoscape / Web Worker ]
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
       [ Visual Style LOD ]                        [ Interactive Unfold ]
  cy.on('zoom') -> Taxi <-> Straight       Tap collapsed node -> Expand cluster
  (远景极简直连线，消除 Taxi 拐点开销)          Toolbar button -> Toggle all
```

---

## 2. 核心模块与算法设计 (Module & Algorithm Design)

### 2.1 `src/lod-service.js` 纯图拓扑抽稀引擎

- **单向链检测算法**：
  1. 构建图邻接索引：`inMap = Map<targetId, Array<edge>>`, `outMap = Map<sourceId, Array<edge>>`, `nodeMap = Map<nodeId, node>`.
  2. 寻找链起始条件：节点 $v_0$ 满足 `outDegree(v_0) === 1`，且其下游节点 $v_1$ 满足 `inDegree(v_1) === 1`。
  3. 沿单出单入路径向下遍历推进：
     - 若候选节点 $v_i$ 满足：
       - `inDegree === 1` 且 `outDegree === 1`
       - 并且不在保护集合中 (`!isBookmark`, `!hasMemory`, `!isCurrent`, `!isRoot`)
     - 则将 $v_i$ 纳入当前候选折叠序列 $S$。
  4. 遍历终止条件：遇到分叉点 (`outDegree > 1` 或 `inDegree > 1`)、叶子节点 (`outDegree === 0`)、受保护节点或图终点。
  5. 长度判定：若候选折叠序列 $|S| \ge \text{minChainLength}$，则生成折叠聚合簇 `Cluster`。
  6. 替换生成：
     - 原始序列的所有边被安全剥离；
     - 新建合成节点 `node.collapsed_X_Y`，具有唯一的 clusterId 与计数值；
     - 建立从上游端点到合成节点、从合成节点到下游端点的两条代理边。

- **局部展开与全局展开缓存**：
  - 内部维持 `expandedClusterIds = Set<string>`；
  - 当用户点击某个折叠节点时，仅将该 clusterId 加入展开集合并重新生成 elements，避免整图重绘颠簸。

### 2.2 `src/style.js` 视觉分级与样式映射

- **折叠节点样式规则**：
  ```css
  node[?isCollapsedCluster] {
      shape: round-rectangle;
      width: 60px;
      height: 24px;
      background-color: #334155;
      border-width: 2px;
      border-style: dashed;
      border-color: #94a3b8;
      label: data(label);
      font-size: 11px;
      color: #f1f5f9;
      text-valign: center;
      text-halign: center;
  }
  ```
- **宏观远景 (Macro LOD) 样式规则**：
  ```css
  .lod-macro edge {
      curve-style: straight !important;
      width: 1.5px !important;
  }
  .lod-macro node {
      border-width: 0px !important;
      underlay-opacity: 0 !important;
  }
  ```

### 2.3 `index.js` 交互事件与控制管道

- **防抖缩放监听器**：
  - 监听 `cy.on('zoom')`，经 100ms 防抖后获取 `cy.zoom()`。
  - 判定：若 `zoom < 0.35` 且未挂载 `.lod-macro`，调用 `cy.container().classList.add('lod-macro')` 并更新关键边属性；反之移除。
- **点击展开**：
  - 监听 `cy.on('tap', 'node[?isCollapsedCluster]')`，调用 `lodService.toggleExpand(clusterId)` 并驱动局部平滑过渡。
- **工具栏与设置同步**：
  - 工具栏添加 `.toggle-lod-collapse` 按钮，高亮与折叠状态同步；
  - 设置变更即时更新，自动保存到 `extension_settings.timeline`。

---

## 3. 容错与优雅降级 (Fault Tolerance & Graceful Degradation)

1. **节点数低于阈值保护**：
   - 若全图总节点数小于 `lodTotalNodeThreshold`（默认 100），无论是否开启 LOD，均保持全量展开，避免日常短小对话过度折叠。
2. **绝对零数据污染**：
   - 所有折叠运算仅针对 Cytoscape elements 的内存瞬时副本，绝不回写原生会话文件或 IndexedDB 原始缓存。
3. **Minimap 兼容**：
   - 小地图接收 Cytoscape 的当前活跃 elements，自动与抽稀后的时间树保持 1:1 视口与拓扑同步。
