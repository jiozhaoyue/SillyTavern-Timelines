# Implementation Plan: 时间树与 Luker 记忆图 (memory-graph) 主动深度联动与 API 暴露

## 实施阶段与步骤

### 阶段 1：核心服务与算法实现（支持单元测试）
1. 编写 `src/memory-graph-service.js`：
   - 封装与 `memory-graph` 的交互（Lookup API、InjectionState、EventBundle）。
   - 实现安全的 fallback 与错误捕获机制。
2. 编写 `src/api.js`：
   - 实现 `registerExtensionApi('timelines', ...)` 逻辑。
   - 实现 LCA、祖先因果链回溯、分支节点提取等拓扑算法。
3. 编写 `tests/memory-interop.test.mjs`：
   - 验证 `memory-graph-service.js` 与 `api.js` 在各种边缘情况（无插件、空节点、单根、深层分支）下的表现。
   - 运行并确保所有测试 100% 绿灯。

### 阶段 2：UI 视觉与卡片联动集成
1. 修改 `src/style.js` 与 `style.css`：
   - 增加 `.has-memory`、`.memory-injected-recalled`、`.memory-injected-always` 与 `.dimmed` 样式类。
2. 修改 `src/utils.js`：
   - 扩充节点弹窗详情模板，展示记忆卡片、地点、人物与当前注入状态。
3. 修改 `timeline.html` 与 `src/timeline.js`：
   - 在顶部工具栏/图例增加记忆里程碑过滤按钮。
   - 绑定高亮切换与 Cytoscape 批量样式应用。

### 阶段 3：右键上下文菜单与快捷补录
1. 修改 `src/context-menu.js`：
   - 增加记忆详情查看弹窗。
   - 增加“补录记忆”操作弹窗，支持调用 `openSession().createNode` 快捷写入。

### 阶段 4：自动化回归测试与实机验证
1. 运行 `node --test tests/*.test.mjs`。
2. 编写 CDP 脚本并在实机 Luker 环境验证记忆渲染与 API 调用。
