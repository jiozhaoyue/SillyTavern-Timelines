# Design: 时间树与 Luker 记忆图 (memory-graph) 主动深度联动与 API 暴露

## 1. 架构总览

本模块包含两个子系统：
1. **主动消费层 (`src/memory-graph-service.js`)**：检测并对接 `memory-graph` 的 `registerExtensionApi('memory-graph')`，获取事件数据与当前 Prompt 注入状态，并驱动时间线图谱渲染。
2. **对外供给层 (`src/api.js`)**：向 `Luker.getContext().registerExtensionApi('timelines', ...)` 注册标准扩展接口，供第三方消费时间树因果拓扑。

---

## 2. 模块细化设计

### 2.1 记忆服务层 (`src/memory-graph-service.js`)

#### 接口定义
```javascript
export class MemoryGraphService {
  constructor(context) { ... }
  // 获取 memory-graph API 实例，不存在则返回 null
  getApi(): MemoryGraphApi | null
  // 查询指定消息楼层的记忆事件束
  async getBundleForMessage(messageIndex: number): Promise<MemoryBundle | null>
  // 获取当前 prompt 注入状态集合 (alwaysInjectIds, recallSelectedIds, visibleIds)
  async getInjectionState(): Promise<InjectionState>
  // 为图谱所有节点构建记忆快照缓存
  async buildMemoryCache(cyNodes: any[]): Promise<Map<string, MemoryNodeMeta>>
  // 监听记忆库提交与注入变化事件
  subscribeChanges(onUpdate: () => void): () => void
  // 快速创建记忆事件
  async createQuickMemoryEvent(params: { messageIndex: number, title: string, summary: string }): Promise<string>
}
```

#### 楼层映射机制
- `memory-graph` 的事件使用 1-based 的 `seq`（仅针对 AI 回复计数），通过 `getAssistantSeqForMessageIndex(context, messageIndex)` 进行转换。
- 对于用户或系统消息节点，取其前置或后置最近的 AI 消息进行推导关联，或仅在有对应的 assistant 节点上标记记忆。

### 2.2 视觉与图谱样式增强 (`src/style.js`)
- Cytoscape 节点新类名定义：
  - `node.has-memory`:
    - `border-color: #a855f7` (柔和高雅紫)
    - `border-width: 3px`
    - `border-style: solid`
  - `node.memory-injected-recalled`:
    - `border-color: #10b981` (翠绿/青色表示本轮命中召回)
    - `border-width: 4px`
    - `background-blacken: -0.1`
  - `node.memory-injected-always`:
    - `border-color: #f59e0b` (金色表示常驻置顶)
    - `border-width: 4px`

### 2.3 记忆里程碑过滤器 (`src/timeline.js`)
- `toggleMemoryFilter(enabled: boolean)`:
  - 开启时：
    - `cy.elements().addClass('dimmed')`
    - 找出所有 `has-memory` 节点及其最短因果树路径（向 root 溯源的所有边与父节点），移除 `dimmed` 类并添加 `memory-highlight`。
  - 关闭时：
    - 移除所有 `dimmed` 与 `memory-highlight` 类，恢复正常显示。

### 2.4 对外扩展 API (`src/api.js`)
- 注册至 `Luker.getContext().registerExtensionApi('timelines', ...)`：
  - `getTimelineTree()`: 返回当前 Cytoscape 图的 elements JSON。
  - `getBranchLineage(nodeId)`: 返回该节点追溯到 root 的节点链表 `[root, ..., node]`。
  - `getCurrentBranchNodes()`: 当前激活分支的有序节点列表。
  - `computeBranchLCA(nodeId1, nodeId2)`: 返回二者因果树的最近公共祖先节点 ID。
  - `onBranchSwitched(callback)`: 监听时间线分支切换。

---

## 3. 安全降级与单测验证策略
- 纯净度隔离：所有依赖 Luker 环境的代码通过可注入的 `context` 与 `apiProvider` 进行测试。
- 在 `tests/memory-interop.test.mjs` 中模拟 `memory-graph` 的读写 API，验证 LCA 计算、祖先链生成、楼层转换与空安全逻辑。
