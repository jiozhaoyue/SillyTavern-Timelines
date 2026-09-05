# 智能全景雷达与多维复合检索器 PRD

## 1. 背景与目标
在数千节点的宏大时间树中，玩家需要精确定位特定情节（例如：“寻找第 20~50 楼包含‘龙’且由 Character 发言的书签节点”）。原有的单行子字符串搜索无法满足多维复合筛选需求，也无法像 IDE 搜索一样逐个跳跃定位。
本功能旨在提供一套多维检索雷达服务（Search Radar Service）与浮层交互控制器（Search Radar Controller）：
1. 多维复合检索：
   - 文本与正则：支持普通关键词分词，支持以 `/pattern/flags` 形式的正则表达式匹配。
   - 角色过滤：全部 (All)、仅玩家 (User)、仅角色 (Character)。
   - 特殊属性过滤：仅书签节点、仅带标签节点、仅含分支重试 (Swipes > 1) 节点。
   - 楼层深度范围：支持按最小/最大楼层深度切片过滤。
2. 雷达遍历与视口脉冲扫荡：
   - 结果计数徽章：实时显示匹配结果 `第 N / M 个匹配`。
   - 快捷键与控制按钮：支持 `Enter` (下一个)、`Shift+Enter` (上一个)。
   - 视口联动：当跳跃到某一匹配项时，Cytoscape 视口平滑居中到该节点，并施加发光脉冲动效。
   - 拓扑调光：非匹配节点与连线施加半透明调光，匹配节点加粗高亮。
3. 纯算法与解耦设计：
   - 检索核心为纯函数 `evaluateSearchQuery(nodeData, filterOptions)`，100% 可单测。
   - 零副作用，无数据篡改，支持随时一键清除还原图谱。

## 2. 交付项
1. `src/search-service.js`:
   - `parseSearchQuery(queryString)`: 解析普通搜索词与正则语法。
   - `filterGraphNodes(nodes, filterOptions)`: 纯函数多维复合过滤。
2. `src/search-radar.js`:
   - 悬浮雷达控制器，包含展开式筛选器抽屉、匹配计步器、前进/后退跳跃按钮、清除按钮。
3. UI 与样式:
   - 更新 `timeline.html` / `settings.html` 搜索框周边控件。
   - `style.css` 增加雷达计数徽章、筛选面板与响应式断点。
   - `index.js` 接入雷达事件调度。
4. 测试与验证:
   - 单元测试 `tests/search-radar.test.mjs`。
   - Chrome CDP 实机测试与全流程验证。
