# 技术方案设计: 时间线分支高级管理与差异对比 (Design Document)

## 1. 架构模块划分

```text
src/
├── branch-manager.js        # 新增：分支操作核心 (创建分支、删除分支、与酒馆宿主联动)
├── diff-service.js          # 新增：拓扑 LCA 计算与差异序列提取算法
├── diff-modal.js            # 新增：差异对比弹窗 UI 渲染与分支切换
├── context-menu.js          # 新增：Cytoscape context-menus 注册、菜单项与行为调度
└── graph-builder.js         # 复用：已有的 Map<id, node> 拓扑路径辅助
```

---

## 2. 核心算法设计 (`src/diff-service.js`)

### 2.1 最近公共祖先 (LCA) 与分支分歧提取
给定分支节点 $Node_A$ 与 $Node_B$：
1. 分别通过已优化的 `getPathToRoot(nodeA)` 与 `getPathToRoot(nodeB)` 得到从根到端点的有序节点数组：
   - $Path_A = [Root, N_1, N_2, \dots, N_k, A_1, A_2, \dots, Node_A]$
   - $Path_B = [Root, N_1, N_2, \dots, N_k, B_1, B_2, \dots, Node_B]$
2. 线性同步指针扫描至第一个不同的节点，其前一个公共节点 $N_k$ 即为 **LCA 分叉点**。
3. 提取分歧段：
   - $Diff_A = [A_1, A_2, \dots, Node_A]$
   - $Diff_B = [B_1, B_2, \dots, Node_B]$
4. 计算统计数据（各自新增轮数、Token 估算、最新消息时间）。
5. 复杂度：由于路径已被预索引映射加速，整个 LCA 与差异提取耗时为 $O(Depth)$，通常在 **<1ms** 内完成，无需任何网络请求。

---

## 3. 右键菜单与交互流程 (`src/context-menu.js`)

### 3.1 菜单生命周期与挂载
- 当 Cytoscape 实例初始化后，调用 `initContextMenu(cy)`。
- 配置选择器：
  - `node[?msg]`: 作用于普通对话节点。
  - `core`: 作用于画布空白处（提供“重置视图”、“刷新数据”、“折叠所有 Swipes”等快捷操作）。
- 菜单数据绑定：
  - 读取节点的 `chat_sessions` 元数据：
    ```javascript
    const sessions = node.data('chat_sessions');
    const [fileName, meta] = Object.entries(sessions)[0];
    const messageId = meta.messageId;
    ```

### 3.2 关键操作执行链路
1. **创建新分支**:
   ```javascript
   await branchManager.createBranchFromNode(node);
   ```
   内部调用 `createBranch(messageId)`，通知 Luker 切换到新会话，自动更新 `TimelinesCache`，重绘图谱并高亮新产生的分支节点。
2. **删除会话分支**:
   - 弹出 `Popup` 确认：“确定要永久删除分支 [xxx] 吗？此操作不可逆。”
   - 确认后发送 `POST /api/chats/delete`，清除缓存并在图谱中 `cy.remove(node)` 或全局刷新。

---

## 4. UI 呈现规范 (`src/diff-modal.js` & `style.css`)

- **弹窗结构**：采用覆盖在时间线之上的浮层面板 `#timelinesDiffModal`。
- **Header**：
  - 左侧：分支 A 会话名称与色标。
  - 中间：分叉点摘要与分叉深度（如：`于第 12 轮分叉`）。
  - 右侧：分支 B 会话名称与色标、关闭按钮。
- **Body**：双栏卡片网格。每个消息卡片标注发送者头像/名称、楼层、文本内容、Swipe 状态。
- **Footer**：底部分别放置“切换到分支 A”与“切换到分支 B”快捷按钮。
