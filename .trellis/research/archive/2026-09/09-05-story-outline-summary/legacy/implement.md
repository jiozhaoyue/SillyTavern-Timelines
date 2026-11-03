# Implementation Plan: 时间线全局故事大纲视图与关键剧情摘要卡片流导出

## 阶段划分 (Phased Plan)

### Step 1: 故事大纲提炼与 Markdown 导出服务 (`src/story-outline-service.js`)
- 实现 `extractStoryOutline(cy, context)`：
  - 提取主线与各分支路径；
  - 启发式切分章节（分叉点、里程碑标签、轮次区间）；
  - 提炼事件卡片对象（角色、缩略摘要、标签）。
- 实现 `formatStoryOutlineMarkdown(outlineData)`：生成优雅规范的 Markdown 大纲文档。
- 编写纯单元测试 `tests/story-outline.test.mjs`。

### Step 2: 故事大纲模态对话框与 UI 集成 (`src/story-outline-modal.js` & `style.css`)
- 构建 `.timelines-outline-backdrop` 与 `.timelines-outline-dialog`：
  - 左侧章节导航，右侧事件卡片时间轴；
  - 卡片包含楼层徽章、发言人、标签 Chip、精炼台词；
  - 点击事件卡片，调用 Cytoscape 聚焦动画并在对应节点上触发 `tl-node-pulse`；
  - 顶栏提供「📋 复制 Markdown」与「📥 下载 .md 文档」按钮。
- 在 `timeline.html` 与 `settings.html` 顶栏增加 `.toggle-story-outline` 按钮（`fa-solid fa-book-open`，标题“故事大纲与剧情摘要”）。
- 在 `src/context-menu.js` 空白画布菜单中增加“📖 打开故事大纲”。
- 绑定 `index.js` 中的按钮事件。

### Step 3: 实机 CDP 验证与全量回归
- 运行全量单元测试套件：`node --test tests/*.test.mjs`（65+ 用例）。
- 编写 CDP 实机验证脚本 `scratch/verify-outline-live.mjs`：
  - 连接 `https://127.0.0.1:8003`；
  - 点击顶栏大纲按钮唤出面板；
  - 点击事件卡片验证画布聚焦；
  - 测试 Markdown 导出并截图保存。
- 归档任务并记录 Trellis Session 10。
