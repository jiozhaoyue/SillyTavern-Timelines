# Implementation Plan: 分支剧情树深度差异化分析与一键跨分支合并

## 阶段划分 (Phased Plan)

### Step 1: 核心合并与消息移植服务 (`src/merge-service.js`)
- 实现 `cloneNativeMessage(msg)`：原生聊天消息纯净深拷贝与安全校验。
- 实现 `cherryPickMessageToCurrentChat(sourceMsg, options)`：将跨分支消息安全插入当前活动会话并调用原生 `saveChatDebounced()`。
- 实现 `synthesizeMergedChatSequence(commonPrefix, diffA, diffB, strategy)`：基于 LCA 祖先节点合成合并消息流。
- 编写完整的纯逻辑单元测试：`tests/merge.test.mjs`。

### Step 2: 差异对比面板交互重构 (`src/diff-modal.js` & `style.css`)
- 升级 `timelines-diff-dialog` 视觉交互：
  - 增加分支差异统计指标栏（独有轮次、发言人统计、公共深度）；
  - 每张消息卡片增加「🍒 采摘至当前会话」按钮及成功反馈；
  - 顶部增加「🔀 基于分叉点合并并派生新分支」按钮；
  - 支持合并配置对话框（合并顺序选择、新分支名称输入）。
- 适配深色毛玻璃及移动端触控样式。

### Step 3: 实机验证与自动化回归
- 运行全量单元测试套件：`node --test tests/*.test.mjs`（保证 55+ 测试用例全绿）。
- 编写 CDP 实机验证脚本 `scratch/verify-merge-live.mjs`：
  - 连接 `https://127.0.0.1:8003`；
  - 打开 Diff 面板；
  - 点击 Cherry-Pick 采摘单条消息；
  - 验证当前会话消息长度递增，内容与来源一致，截图留存。
- 任务归档与 Trellis Session 9 记录。
