# Technical Design: 分支剧情树深度差异化分析与一键跨分支合并

## 1. 架构定位
本模块作为 `src/diff-service.js` 和 `src/diff-modal.js` 的深度升级，并引入核心合并服务 `src/merge-service.js`。
遵循**原生规范无侵入**原则：通过酒馆官方暴露的 `getContext()`, `saveChatDebounced()`, `reloadCurrentChat()` / `openCharacterChat()` 进行消息操作，不直接在服务端私自篡改文件格式。

```
┌────────────────────────────────────────────────────────┐
│                   Timelines Canvas                     │
│    (Node Right-Click -> "设为基准 A" / "与基准 A 对比")   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                  src/diff-modal.js                     │
│         (Diff 对比浮层：左右双栏 + 逐轮对齐 + 统计)         │
│  - 🍒 Cherry-Pick 单条/选定消息到当前会话                 │
│  - 🔀 基于 LCA 派生合并新会话                             │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                 src/merge-service.js                   │
│  - cloneNativeMessage(msg)                             │
│  - cherryPickMessageToCurrentChat(msg, targetIndex)    │
│  - mergeBranchesToNewChat(pathA, pathB, options)       │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│            SillyTavern Native Chat Engine              │
│       (getContext().chat, saveChatDebounced)           │
└────────────────────────────────────────────────────────┘
```

## 2. 核心模块与接口设计

### 2.1 消息安全克隆与清洗 (`cloneNativeMessage`)
```javascript
export function cloneNativeMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  return {
    name: String(msg.name || ''),
    is_user: Boolean(msg.is_user),
    is_system: Boolean(msg.is_system),
    send_date: msg.send_date || Date.now(),
    mes: String(msg.mes || ''),
    extra: JSON.parse(JSON.stringify(msg.extra || {})),
    swipes: Array.isArray(msg.swipes) ? [...msg.swipes] : undefined,
    swipe_id: typeof msg.swipe_id === 'number' ? msg.swipe_id : undefined,
  };
}
```

### 2.2 单消息跨分支采摘 (`cherryPickMessageToCurrentChat`)
- 校验当前活动会话 `context.chat`；
- 将目标消息使用 `cloneNativeMessage` 深拷贝；
- 插入或追加到当前会话数组：`context.chat.push(clonedMsg)`；
- 触发原生持久化 `saveChatDebounced()`；
- 发送事件或刷新聊天界面，弹出 toastr 成功提示并附带跳转操作。

### 2.3 基于 LCA 的分支合并派生 (`mergeBranchesToNewChat`)
- 提取两分支公共祖先 LCA 前缀链（深度 0 ~ LCA 深度）；
- 合并策略：
  - `APPEND_B_TO_A`：保持分支 A 的差异消息在前，随后追加分支 B 的差异消息；
  - `INTERLEAVED`：按发言人角色与时序交替排列；
- 构造完整的新会话消息序列（保留原会话元数据首行 line 0）；
- 调用原生新建/保存会话流程，命名如 `Merge_[A]_[B]_[Timestamp]`；
- 自动载入新合并会话。

## 3. 安全性与容错
- 严格禁止在会话第 0 项（元数据）插入普通消息；
- 采摘前若当前会话未就绪，立即防御性拦截并友好提示；
- 每次会话写入前保留快照或调用原生防抖安全写。
