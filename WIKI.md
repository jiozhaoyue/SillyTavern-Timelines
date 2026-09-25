# 📚 SillyTavern-Timelines 官方全景开发与使用指南 (Project Wiki)

> **版本**：v2.4.0-pro  
> **适用环境**：SillyTavern 1.11+ / Luker (现代化重构分支)  
> **核心规范**：严格遵循原生数据契约 · 零外部私有数据库 · 微内核解耦总线

---

## 目录 (Table of Contents)
- [1. 项目概述与设计哲学](#1-项目概述与设计哲学)
  - [1.1 项目背景与演进路线](#11-项目背景与演进路线)
  - [1.2 核心哲学：非破坏性与零私有数据库](#12-核心哲学非破坏性与零私有数据库)
  - [1.3 微内核总线与生态解耦架构](#13-微内核总线与生态解耦架构)
- [2. 酒馆原生数据契约与运行机制](#2-酒馆原生数据契约与运行机制)
  - [2.1 原生 JSONL 结构与 Line 0 元数据保护](#21-原生-jsonl-结构与-line-0-元数据保护)
  - [2.2 message.extra 契约与非破坏式注水](#22-messageextra-契约与非破坏式注水)
  - [2.3 原生分支派生与时空穿越机制](#23-原生分支派生与时空穿越机制)
- [3. 图引擎与全链路性能架构](#3-图引擎与全链路性能架构)
  - [3.1 增量分层缓存机制 (timelinesCache)](#31-增量分层缓存机制-timelinescache)
  - [3.2 拓扑去重与 O(1) 回溯算法](#32-拓扑去重与-o1-回溯算法)
  - [3.3 Web Worker 异步 Dagre 布局](#33-web-worker-异步-dagre-布局)
  - [3.4 动态智能长链抽稀折叠 (LOD)](#34-动态智能长链抽稀折叠-lod)
  - [3.5 双缓冲 Canvas 全景小地图与几何投影](#35-双缓冲-canvas-全景小地图与几何投影)
  - [3.6 渐进式渲染管线与极端内存优化（细腰图）](#36-渐进式渲染管线与极端内存优化细腰图)
- [4. 全功能交互与实操手册](#4-全功能交互与实操手册)
  - [4.1 全景拓扑交互与视口操作](#41-全景拓扑交互与视口操作)
  - [4.2 顶部折叠式全景小地图与鸟瞰快速穿梭](#42-顶部折叠式全景小地图与鸟瞰快速穿梭)
  - [4.3 节点右键分支管理与安全删除](#43-节点右键分支管理与安全删除)
  - [4.4 双栏分支差异对比与 LCA 分歧点解析](#44-双栏分支差异对比与-lca-分歧点解析)
  - [4.5 单消息 Cherry-Pick 采摘与跨分支合并 (Merge)](#45-单消息-cherry-pick-采摘与跨分支合并-merge)
  - [4.6 原生书签与彩色标签管理索引抽屉](#46-原生书签与彩色标签管理索引抽屉)
  - [4.7 全局故事大纲视图与章节摘要导出](#47-全局故事大纲视图与章节摘要导出)
  - [4.8 剧情分支深度量化统计与全景数据看板](#48-剧情分支深度量化统计与全景数据看板)
  - [4.9 分支检查点快照与时光机存档画廊](#49-分支检查点快照与时光机存档画廊)
  - [4.10 智能全景雷达与多维复合检索器](#410-智能全景雷达与多维复合检索器)
  - [4.11 4K/8K 超大画幅高保真导出与无依赖 SVG 矢量图](#411-4k8k-超大画幅高保真导出与无依赖-svg-矢量图)
  - [4.12 移动端捏合缩放、长按防抖与响应式适配](#412-移动端捏合缩放长按防抖与响应式适配)
  - [4.13 语义检索与跨会话搜索（可选 Authority 集成）](#413-语义检索与跨会话搜索可选-authority-集成)
- [5. 开放扩展 API 与生态互通规范](#5-开放扩展-api-与生态互通规范)
  - [5.1 window.TimelinesExtensionApi 核心规范](#51-windowtimelinesextensionapi-核心规范)
  - [5.2 微内核修饰器注册 (registerNodeDecorator)](#52-微内核修饰器注册-registernodedecorator)
  - [5.3 记忆图谱 (Memory Graph) 零耦合适配范式](#53-记忆图谱-memory-graph-零耦合适配范式)
  - [5.4 拓扑因果溯源与最近公共祖先 (LCA) 计算](#54-拓扑因果溯源与最近公共祖先-lca-计算)
- [6. 开发者与测试规范](#6-开发者与测试规范)
  - [6.1 目录拓扑说明](#61-目录拓扑说明)
  - [6.2 自动化测试套件 (118+ 单元测试)](#62-自动化测试套件-118-单元测试)
  - [6.3 基于 Chrome DevTools Protocol (CDP) 的端到端自动化验证](#63-基于-chrome-devtools-protocol-cdp-端到端自动化验证)

---

## 1. 项目概述与设计哲学

### 1.1 项目背景与演进路线
SillyTavern-Timelines 原生旨在为大语言模型角色扮演（LLM Roleplay）与分支叙事交互式故事提供基于 DAG（有向无环图）的可视化探索能力。玩家在多分支会话、重试生成（Swipes）、检查点创建中穿梭，传统的单线聊天列表无法表达故事全貌。

本项目在经历全面重构后，不仅攻克了千节点级渲染卡顿、Worker 布局阻塞、移动端手势冲突等性能壁垒，更构建了涵盖**差异对比、单消息采摘合并、故事大纲梳理、量化数据看板、时光机归档、智能搜索雷达、渐进式渲染与细腰图内存极压、语义跨会话检索、高保真矢量导出**的工业级叙事探索工作台。

### 1.2 核心哲学：非破坏性与零私有数据库
- **严格基于原生文件**：绝不在插件目录下建立独立的私有 SQLite、LevelDB 或 IndexedDB 专有数据库。所有的节点、分支、书签、彩色标签、快照命名均存储在酒馆原生的会话文件（`chat.jsonl`）的 `message.extra` 契约中。
- **无破坏性与可逆性**：卸载本插件后，原生的所有会话记录完好无损，酒馆原生核心引擎对 `message.extra` 的读取完全透明合规。
- **只读分析与原生委托写**：插件所有写操作（如打标签、修改书签、合并分支）均委托给原生酒馆的核心 API（如 `saveChatDebounced`、`createBranch`、`openCharacterChat`），绝不擅自使用 Node.js 直接覆写用户聊天文件。
- **派生投影而非私有数据**：可选语义检索（Trivium 向量索引）完全寄生于外部可选的 Authority 服务，其全部数据（向量索引 + `index_state` 状态表）均为原生 `message.extra` 的**可随时删除重建的派生投影**；未安装 Authority 时零依赖、零行为变化。

### 1.3 微内核总线与生态解耦架构
所有对外暴露的能力、第三方扩展集成（如“记忆图谱 Memory Graph”）均通过解耦总线 `src/api.js` (`window.TimelinesExtensionApi`) 进行交互。第三方扩展无需修改 Timelines 内部任何源码，只需注册 Decorator 或监听广播事件即可完成无缝图谱装配。

```
                   ┌─────────────────────────────────────────┐
                   │    第三方扩展 (例如: Memory Graph)       │
                   └────────────────────┬────────────────────┘
                                        │ registerNodeDecorator
                                        │ registerToolbarAction
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│               Timelines Microkernel Bus (src/api.js)                       │
│  - window.TimelinesExtensionApi                                            │
│  - Event Hook Pipeline (beforeRender, decorateNode, onClick)               │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
    ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
    │  Cytoscape 图谱 │        │  全景数据看板   │        │  时光机/大纲流  │
    └─────────────────┘        └─────────────────┘        └─────────────────┘
```

---

## 2. 酒馆原生数据契约与运行机制

### 2.1 原生 JSONL 结构与 Line 0 元数据保护
酒馆的聊天文件采用 JSON Lines 规范保存：
- **第 0 行 (Line 0)**：会话元数据（包含当前角色名、用户名称、创建时间戳、分支来源 `from_branch`、分叉点 `branch_id` 等关键头信息）。
- **第 1 行起 (Line 1..N)**：真正的逐轮聊天消息对象（`user_name`, `name`, `is_user`, `send_date`, `mes`, `extra` 等）。

> **核心原则**：在任何采摘（Cherry-Pick）、分支创建、分支合并时，必须严格保留源会话 Line 0 的头部完整性，且必须深克隆消息内容，杜绝浅拷贝引用污染。

### 2.2 message.extra 契约与非破坏式注水
酒馆为每条消息预留了开放元数据槽位 `message.extra`。Timelines 在此规范下进行功能扩展：
- 书签字段：`message.extra.bookmark = true`
- 标签字段：`message.extra.tags = ['主线', '决战']`
- 时光机快照字段：`message.extra.snapshotTitle = '营地休憩与告白'`
- 跨轮次 Swipes 隔离：每个 swipe 消息对应独立的 `extra` 实例，杜绝不同重试项之间的元数据串扰。

### 2.3 原生分支派生与时空穿越机制
- **分支创建**：通过酒馆原生 `bookmarks.js` 中的 `createBranch(messageId)` 派生分支，原生会自动生成带有时间戳的新 `.jsonl` 文件，并在当前消息插入引用链接。
- **分支穿越**：利用 `window.SillyTavern.getContext().openCharacterChat(chatFileName)` 原生调度器执行跨会话切换，并随后调用 `navigateToMessage(floor)` 滚动主聊天窗口至对应楼层，实现丝滑的“时空穿越”。

---

## 3. 图引擎与全链路性能架构

### 3.1 增量分层缓存机制 (timelinesCache)
位于 `src/cache.js`：
- 构建了基于会话文件指纹（`mtime` + `size`）的二级缓存架构（内存 WeakMap + 跨生命周期 Storage）。
- 当角色拥有数百个分支文件时，仅解析最近发生过变动的 `.jsonl` 文件，其余分支直接从缓存取回解析后的消息数组，将拓扑构建由秒级（>3000ms）降至毫秒级（<80ms）。

### 3.2 拓扑去重与 O(1) 回溯算法
位于 `src/graph-builder.js`：
- **跨会话共享节点去重**：从根节点至分叉点之间，所有分支在内容与深度完全一致的消息会被聚合成单一全局唯一节点，边关系进行哈希去重。
- **O(1) 祖先回溯**：在回溯至根节点计算因果链时，通过内建的反向有向边引用（`incomers('edge')`），单次 1000 节点回溯耗时小于 3ms。

### 3.3 Web Worker 异步 Dagre 布局
位于 `src/layout-service.js`：
- 将耗时密集的有向图层次布局计算（Dagre Rank & Order 分配）完全移入后台独立 Web Worker。
- Worker 布局计算期间，主线程保持 60 FPS 丝滑动画，绝无 UI 冻结。当主线程处于 Node.js 测试环境或不支持 Worker 时，自动优雅降级为同步内存布局。

### 3.4 动态智能长链抽稀折叠 (LOD)
位于 `src/lod-service.js`：
- 在单线长对话（例如连续 30 轮线性剧情没有分支）中，用户全图视野容易被无限拉长。
- LOD 算法自动识别长度大于阈值（默认 10 轮）的纯线性无分叉链条，将其智能聚合成单个带摘要的“折叠单链节点”，并自动构建拓扑穿透桥接边。
- 用户可随时点击顶部 `.toggle-lod-collapse` 或双击聚合节点手动展开/收起任意链条。

### 3.5 双缓冲 Canvas 全景小地图与几何投影
位于 `src/minimap.js` 与 `src/minimap-math.js`：
- 采用离屏 Double-buffering Canvas 渲染拓扑简图，避免主画布频繁重绘。
- 提供基于仿射变换（Affine Projection）的视口数学转换，实时在小地图上投射当前相机的取景框矩形。
- 支持在小地图上直接点击与拖拽，实现毫秒级相机居中穿梭。

### 3.6 渐进式渲染管线与极端内存优化（细腰图）
位于 `src/node-data.js`、`src/incremental-merge.js`、`src/load-progress.js`、`src/memory-profile.js`：

- **画布先行（Canvas First）**：点击打开时间线不再出现全屏加载遮罩，空骨架画布立即呈现，数据管线完全后台化。
- **渐进数据管线 (`prepareDataProgressive`)**：以单文件粒度产出会话数据——当前活跃会话最先上屏（用户所在分支优先可见）→ IndexedDB 缓存命中分块回放 → 网络按画像并发拉取；每个文件就绪即刻触发增量渲染，不等整批。
- **增量补丁 (`incremental-merge.js`)**：加载期间以 600ms 节流执行 rebuild，并做 id 级 diff 增量补丁上屏，避免大图反复全量重绘。
- **全程进度胶囊 (`load-progress.js`)**：常驻进度胶囊按阶段权重展示百分比与实时文件名，完成自动淡出、失败红态提示。
- **设备画像 (`memory-profile.js`)**：按内存 / 核数 / 触屏特征自动判定档位（`auto/on/off` 三档设置）——弱设备自动启用"细腰图"省内存模式：节点文本截断为预览（移动端 160 字、桌面端 240 字）、网络并发降为 4；强设备保持全文渲染，行为与旧版逐字节一致。
- **按需全文 (`getFullNodeText` / `src/node-text.js`)**：细腰图节点的详情面板提供「展开全文」就地还原原始楼层消息（swipe 节点还原对应 swipes 变体），并可一键「复制全文」到剪贴板，可随时收起回预览态；解析失败优雅回退预览。
- **全文消费方贯通**：语义索引构建、故事大纲提炼等文本交付场景会在读取阶段自动解析截断节点的全文（按需经 IndexedDB 缓存），保证向量质量、内容指纹与导出完整性不受设备画像影响；普通词法检索在省内存模式下按预览文本匹配。

---

## 4. 全功能交互与实操手册

### 4.1 全景拓扑交互与视口操作
- **打开入口**：
  - 点击扩展顶栏工具条的沙漏图标；或使用斜杠命令 `/tl`。
- **常用快捷键**：
  - `Ctrl + Shift + F`：一键定位聚焦智能检索雷达。
  - `Escape`：关闭当前弹窗或清除当前雷达检索高亮。
- **工具栏核心按钮**：
  - `expand` (`fa-expand`)：一键切换是否全量展开所有 Swipes 重试节点。
  - `reload` (`fa-sync`)：强制重新拉取并重构全量时间树拓扑。
  - `zoomtofit` (`fa-magnifying-glass-plus`)：视口自动平移缩放以适应全图范围。
  - `zoomtocurrent` (`fa-magnifying-glass-location`)：快速平移居中至当前正在聊天的最新消息末梢。

### 4.2 顶部折叠式全景小地图与鸟瞰快速穿梭
- **唤起**：点击工具栏的小地图按钮 `.toggle-minimap` (`fa-map`)，顶部展开毛玻璃鸟瞰抽屉。
- **操作**：
  - 抽屉内清晰绘制出整棵时间树的微缩拓扑脉络。
  - 白色/青色半透明方框代表当前用户屏幕的“取景框”。
  - 直接在小地图任意位置点击或拖曳取景框，底层的 Cytoscape 大画幅将平滑同步平移。

### 4.3 节点右键分支管理与安全删除
- **创建分支**：
  - 在任意历史消息节点上右键单击（触控屏为长按），选择 `🌱 从此处分叉新会话`。
  - 系统基于该节点的 floor 索引原生调用 `createBranch()`，自动创建新会话并在主界面无缝切换。
- **删除分支**：
  - 在节点上右键单击，选择 `🗑️ 删除此会话分支`。
  - 弹出安全确认弹窗，确认后调用原生会话删除接口彻底清理无用 `.jsonl` 废弃分支，绝不残留垃圾引用。
- **复制消息全文**：
  - 在节点上右键单击，选择 `📋 复制消息全文`。
  - 经 IndexedDB 缓存解析楼层原文复制到剪贴板：swipe 节点复制对应变体，细腰图截断节点自动还原完整文本（Clipboard API 不可用时自动回退 execCommand）。

### 4.4 双栏分支差异对比与 LCA 分歧点解析
- **操作**：
  - 在起点分支右键选择 `🔍 标记为对比基准分支 A`。
  - 在目标分支右键选择 `⚖️ 与基准分支对比 (Diff)`。
- **功能特性**：
  - 自动通过祖先回溯算法计算出两支剧情的**最近公共祖先节点 (LCA, Lowest Common Ancestor)**。
  - 弹出高保真双栏对比面板，高亮标明分歧点前相同的历史轮次，以及分流后各自独立演化出的剧情差异。
  - 统计栏实时量化：各自独占消息数、分歧轮次、字数规模对比。

### 4.5 单消息 Cherry-Pick 采摘与跨分支合并 (Merge)
- **逐消息采摘 (Cherry-Pick)**：
  - 在 Diff 对比视图中，每条消息卡片右上角均提供 `🍒 采摘至当前会话` 按钮。
  - 点击后，该消息会被深克隆并安全追加至当前聊天会话的最新楼层，自动维护 `message.extra` 与 Line 0 契约。
- **基于 LCA 派生新分支合并 (Branch Merge)**：
  - Diff 弹窗底部提供 `🔀 合并为新分支` 动作。
  - 用户可选择合并策略（交替对话合并、顺序追加合并），系统将基于公共分叉点自动调用 `createBranch(lca.messageId)`，并在派生会话中无缝缝合两个分支的剧情！

### 4.6 原生书签与彩色标签管理索引抽屉
- **打标签与书签**：
  - 右键任意节点选择 `🏷️ 管理剧情标签与书签`。
  - 勾选 `⭐ 设为关键书签`，或从预设调色板（主线、战斗、日常、好感、伏笔、备忘）中选择或自定义输入新标签。
- **标签索引抽屉**：
  - 点击工具栏书签图标 `.toggle-tags-drawer` (`fa-bookmark`)。
  - 顶部展开标签抽屉，按彩色徽章聚合展示当前树中所有标签及其包含的节点列表。
  - 点击任意标签或书签项，视口立即居中并以高亮脉冲锁定目标节点。

### 4.7 全局故事大纲视图与章节摘要导出
- **入口**：点击工具栏书本图标 `.toggle-story-outline` (`fa-book-open`) 或画布空白处右键菜单。
- **特性**：
  - **智能分章**：基于主干路径、剧情分歧点、用户书签与 10 轮叙事步长，将庞杂的时间树自动梳理划分为结构严谨的章节列表（如 `第一章：序幕`、`第二章：分歧剧情`）。
  - **事件摘要流**：章节内按时间轴展示发言角色、台词摘要、标签徽章与分叉指示。
  - **双向视口联动**：在弹窗中点击任意事件卡片，底层拓扑图同步平滑平移至该节点并闪烁脉冲。
  - **一键导出研报**：支持一键复制或下载为标准的 GitHub Flavored Markdown (GFM) 故事大纲文档。

### 4.8 剧情分支深度量化统计与全景数据看板
- **入口**：点击工具栏饼图图标 `.toggle-timeline-analytics` (`fa-chart-pie`)。
- **核心数据指标**：
  - **拓扑规模**：总剧情节点数、探索到的结局分支数、最大剧情深度、分叉决策点总数与平均分叉度。
  - **发言天平 (Dialogue Balance)**：User 与 Character 的发言轮次比例、总字数比例、平均单条长度，直观评估互动深度。
  - **探索深度**：Swipes 样本生成总数、单轮最高重试深度、分支探索活跃度。
  - **标签分布**：Top 15 高频剧情标签词频排行。
- **导出研报**：支持一键复制高颜值 Markdown 统计研报或下载原始 JSON 数据。

### 4.9 分支检查点快照与时光机存档画廊
- **入口**：点击工具栏时光机图标 `.toggle-branch-snapshots` (`fa-clock-rotate-left`)。
- **特性**：
  - **时间轴画廊**：聚合整棵时间树的所有书签、自定义命名快照、根节点与重要分流点，以带发光时间轴轨道的形式整齐呈现。
  - **实时检索**：支持按快照标题、台词台词片段、角色名、标签或楼层即时模糊搜索。
  - **双动作按钮**：
    - `🎯 定位`：平滑飞越至图谱对应节点并触发脉冲高亮。
    - `🚀 穿越`：如果快照处于其他会话分支，自动调用 `openCharacterChat` 跨分支穿越会话，并滚动到对应楼层。

### 4.10 智能全景雷达与多维复合检索器
- **入口**：搜索框右侧伴随式控件，或快捷键 `Ctrl + Shift + F`，或画布右键菜单 `🔍 聚焦智能检索雷达`。
- **检索语法与模式**：
  - **普通分词**：空格分隔的多词 `AND` 检索（如 `dragon castle`）。
  - **正则表达式**：完整支持 `/pattern/flags` 语法（如 `/(龙\|魔王)/i`）。
- **复合筛选气泡面板 (`.radar-filter-popover`)**：
  - 角色单选：全部 / 仅玩家 (User) / 仅角色 (Character)。
  - 属性复选：仅书签里程碑、仅带标签节点、仅含分支重试 (Swipes > 1)。
  - 楼层切片：支持指定 `Min Floor` 与 `Max Floor` 深度区间。
- **雷达遍历控制**：
  - 匹配计数徽章实时显示：`当前匹配序号 / 总匹配数`。
  - `Enter`：聚焦下一个匹配项并缩放居中。
  - `Shift + Enter`：聚焦上一个匹配项。
  - 非匹配节点与连线施加平滑半透明调光（Dimmed），匹配节点高亮，当前聚焦节点发光脉冲。

### 4.11 4K/8K 超大画幅高保真导出与无依赖 SVG 矢量图
- **入口**：点击工具栏相机图标 `.export-timeline-btn` (`fa-camera`)。
- **四级规格**：
  - 标准高清 (Standard 1.5x)
  - 2K 超清 (2K Presentation 2.0x)
  - 4K 印刷级 (4K Poster 3.0x)
  - 8K 极客归档 (8K Ultra 4.0x)
- **安全缩放算法 (`calculateSafeScale`)**：智能评估当前图谱像素尺寸，严格将最大长宽限制在浏览器 Canvas 安全极限（16384px）内，彻底防止移动端或大图 OOM 崩溃。
- **独立 SVG 矢量导出**：内置完全无依赖的 SVG XML 序列化引擎，即使在离线无第三方包环境下也能稳定导出纯矢量图。

### 4.12 移动端捏合缩放、长按防抖与响应式适配
- **触控优化**：
  - 禁用 Cytoscape 默认的框选（Box Selection），解决移动端单指滑动画布被误当成框选的冲突。
  - `touch-action: none` 防止浏览器原生捏合缩放截断手势事件。
- **长按唤起菜单**：针对触控屏长按（`taphold`），自动转换坐标并精准在手指触点弹出上下文操作菜单。
- **响应式排版**：所有弹窗（大纲、看板、时光机、Diff 对比）在屏幕宽度小于 768px 时自动切换为单列排版与满屏自适应，按钮尺寸符合移动端 38px 触控标准。

### 4.13 语义检索与跨会话搜索（可选 Authority 集成）
本插件默认**零依赖、零行为变化**；当宿主环境安装了可选的外部服务 ST-Delegation-of-authority（Authority）时，自动解锁语义检索能力：

- **设置面板**（扩展设置 → 语义检索）：
  - `启用语义检索`：总开关，开启后搜索雷达自动追加语义模式入口。
  - `跨角色全局检索（含其他角色）`：默认关闭（仅当前角色）；开启后检索不再限定当前角色，跨会话结果按来源角色分组并显示来源徽标。
  - `Embedding 端点` 与 `批量大小`：对接宿主向量化接口（默认 `/api/embeddings/compute`）。
  - 面板实时显示 Authority 就绪状态与索引统计（节点数、向量维度、最近索引时间）。
- **语义索引构建 (`src/semantic-index-service.js`)**：
  - 直接枚举当前图谱的 `chat_sessions` 覆盖全部 (会话, 楼层)，以 `content_hash` 内容指纹做增量 diff，只重索引新增或变化条目。
  - externalId 契约：`<chatFile>::<messageId>`；向量维度进入库名（`tl_vec_<dim>`），embedding 后端更换导致维度变化时天然切库、绝不混维度。
  - 同会话相邻楼层自动合成 `next` 图链边，辅助上下文邻近召回。
  - 索引 payload 携带作用域键与显示名（`namespace` / `namespaceLabel`），跨角色结果可读来源。
- **雷达语义模式 (`src/semantic-search-service.js`)**：
  - Trivium `searchHybrid` 向量 + BM25 双通道混合检索（权重 0.5）。
  - 复合筛选与语义模式打通：书签走服务端 `payloadFilter` 等值过滤；彩色标签/说话人走客户端后过滤（自动放大召回量补偿）。
  - 命中映射回当前内存图谱节点：已打开分支重排聚焦；未映射命中（其他分支会话）进入**跨会话结果弹窗**，显示会话名、楼层、角色、来源角色与预览，一键时空穿越跳转对应楼层；每张卡可展开**相邻楼层上下文芯片**（Trivium 图链 ±1 楼，点击直达）。
- **全库语义索引聚合 (`src/semantic-index-service.js` `getGlobalIndexStats`)**：数据看板新增「全库语义索引聚合」区块，按角色/群组作用域统计已索引楼层数与最近构建时间（Authority 未就绪或无数据时自动隐藏）。
- **熔断降级 (`src/embedding-provider.js`)**：embedding 接口连续失败时自动熔断，本次会话内回退纯文本检索，绝不阻塞主流程。
- **服务端出网通道 (`src/authority-http-fetch.js`，可选)**：「经 Authority 服务端出网」开关开启后，向量化请求经 `client.http.fetch` 由服务端代理出网（按 hostname 授权并纳入审计），绕过浏览器 CORS；可配合「Embedding 模型名 / API 密钥」对接 OpenAI 兼容端点（请求体同时携带 `model`+`input` 与 `text` 双兼容字段）。注意：环回地址被 Authority SSRF 规则封锁；其余 hostname 需管理员策略放行；密钥随请求头传出，Authority 不保管密钥。
- **数据哲学**：索引与状态表全部是原生数据的派生投影，删除 Authority 数据即等于重置，可随时全量重建。
- **宿主可用性**：实测 Dev Luker（8003）上 Authority 可移植子集全链路可用（适配层 ready、Trivium/SQL 数据面往返）；注意 Luker fork 已移除宿主 embedding 端点（`/api/embeddings/compute` 404），在该宿主构建索引需先解决向量化通道（如经 Authority `http.fetch` 的服务端代理，见 `.trellis/spec/frontend/optional-integration.md` §4）。

---

## 5. 开放扩展 API 与生态互通规范

### 5.1 window.TimelinesExtensionApi 核心规范
Timelines 在浏览器全局环境中挂载 `window.TimelinesExtensionApi`：

```typescript
interface TimelinesExtensionApi {
  // 微内核修饰器注册
  registerNodeDecorator(decorator: NodeDecorator): () => void;
  getNodeDecorators(): NodeDecorator[];

  // 动作注册
  registerToolbarAction(action: ToolbarAction): () => void;
  registerContextMenuAction(action: ContextMenuAction): () => void;
  getContextMenuActions(): ContextMenuAction[];

  // 拓扑分析与因果推断
  getLineageFromElements(cyElements: any, targetNodeId: string): string[];
  computeLowestCommonAncestor(cyElements: any, nodeIdA: string, nodeIdB: string): LCAAnalysisResult;
  getChatBranchNodes(cyElements: any, chatFileName: string): any[];

  // 状态同步
  setTimelineGraphState(nodeData: any, activeChatFile: string): void;
  getTimelineGraphState(): { nodeData: any; activeChatFile: string } | null;
}
```

### 5.2 微内核修饰器注册 (registerNodeDecorator)
任何第三方扩展均可向 Timelines 注册节点外观与行为修饰器：

```javascript
window.TimelinesExtensionApi.registerNodeDecorator({
  id: 'my-custom-plugin-badge',
  priority: 100, // 优先级越高越先执行

  // 在图谱渲染前执行异步数据准备
  beforeRender: async (context, nodeData) => {
    // 拉取外部元数据
  },

  // 对每个 Cytoscape 节点进行属性或样式注入
  decorateNode: (cyNode, nodeData) => {
    if (nodeData.myCustomScore > 80) {
      cyNode.addClass('high-score-node');
    }
  },

  // 点击节点时的拦截或增强
  onClick: (node, event) => {
    console.log('Clicked decorated node:', node.id());
  }
});
```

### 5.3 记忆图谱 (Memory Graph) 零耦合适配范式
位于 `src/adapters/memory-graph-adapter.js`：
- **零硬编码耦合**：Timelines 内部不存在对“记忆图谱”的任何写死依赖。
- **能力嗅探**：通过检查 `window.MemoryGraphApi` 是否就绪；若存在，自动通过 `registerNodeDecorator` 注入记忆气泡标识，并在右键菜单增加“查看关联记忆”动作；若不存在，整套逻辑完全静默，零性能损耗。

### 5.4 拓扑因果溯源与最近公共祖先 (LCA) 计算
- `getLineageFromElements(cy, targetNodeId)`：输入任意叶子或中间节点，顺着有向边反向追踪至故事根起点，输出完整的祖先 ID 顺序数组。
- `computeLowestCommonAncestor(cy, nodeIdA, nodeIdB)`：输入任意两个不同分支上的节点，在 $O(N)$ 时间复杂度内计算出它们的最佳分流决策点，并分离出两条支线自 LCA 之后的独占分歧轨迹。

---

## 6. 开发者与测试规范

### 6.1 目录拓扑说明
```
SillyTavern-Timelines/
├── index.js                     # 插件启动入口与主生命周期调度
├── timeline.html                # 插件主界面容器与 DOM 结构
├── settings.html                # 插件偏好配置抽屉视图
├── style.css                    # 核心视觉系统与响应式样式
├── WIKI.md                      # 官方全景功能与架构开发文档
├── src/
│   ├── api.js                   # 微内核总线与对外开放 API
│   ├── cache.js                 # JSONL 文件分层增量缓存
│   ├── graph-builder.js         # 拓扑去重与因果构建算法
│   ├── layout-service.js        # Web Worker 异步 Dagre 布局服务
│   ├── lod-service.js           # 智能长链抽稀折叠算法 (LOD)
│   ├── context-menu.js          # 上下文右键菜单管理
│   ├── minimap.js               # 全景小地图组件
│   ├── minimap-math.js          # 视口仿射变换纯数学库
│   ├── branch-manager.js        # 原生分支创建与删除
│   ├── diff-service.js          # LCA 祖先分歧分析服务
│   ├── diff-modal.js            # 双栏差异对比交互弹窗
│   ├── merge-service.js         # 单消息采摘与原生合并算法
│   ├── tag-manager.js           # 原生彩色标签与书签系统
│   ├── story-outline-service.js # 故事大纲主干分章提取算法
│   ├── story-outline-modal.js   # 故事大纲卡片流与双向聚焦弹窗
│   ├── analytics-service.js     # 拓扑与对白天平量化统计服务
│   ├── analytics-modal.js       # 全景数据看板模态窗
│   ├── snapshot-service.js      # 时光机快照扫描与排序服务
│   ├── snapshot-modal.js        # 时光机存档画廊与时空穿越弹窗
│   ├── search-service.js        # 正则与多维复合检索纯算法
│   ├── search-radar.js          # 全景雷达遍历控制器
│   ├── node-data.js             # 渐进式数据管线与节点全文解析
│   ├── node-text.js             # 细腰图全文还原纯逻辑（含 swipe 变体）
│   ├── memory-profile.js        # 设备画像判定与预览截断纯算法
│   ├── load-progress.js         # 常驻进度胶囊状态机
│   ├── incremental-merge.js     # id 级增量补丁纯算法
│   ├── semantic-index-service.js # Authority 语义索引（Trivium 写入与增量 diff）
│   ├── semantic-search-service.js # 语义混合检索与跨会话结果格式化
│   ├── semantic-global-modal.js # 跨会话语义结果弹窗
│   ├── embedding-provider.js    # embedding 提供方与熔断降级
│   ├── export-service.js        # 4K/8K 导出与 SVG 矢量生成器
│   ├── export-modal.js          # 导出参数配置弹窗
│   └── adapters/
│       ├── memory-graph-adapter.js # 记忆图谱零耦合微内核适配器
│       └── authority-adapter.js # Authority 可选接入状态机与最小权限嗅探
└── tests/                       # 全量自动化测试套件 (118+ 单元测试)
```

### 6.2 自动化测试套件 (118+ 单元测试)
本项目拥有 100% 覆盖关键业务逻辑的 Node.js 原生测试体系：
```bash
# 执行全量单元测试
node --test tests/*.test.mjs
```
测试矩阵包含：
- `tests/api.test.mjs`：微内核装饰器优先级与生命周期注水测试
- `tests/cache.test.mjs`：大文件增量缓存一致性测试
- `tests/graph-builder.test.mjs`：拓扑去重与 O(1) 回溯基准测试
- `tests/lod.test.mjs`：单链抽稀折叠与桥接边合成测试
- `tests/minimap-math.test.mjs`：双向屏幕投影与视口取景框几何测试
- `tests/diff.test.mjs`：最近公共祖先 (LCA) 计算测试
- `tests/merge.test.mjs`：Line 0 保护、深克隆与单消息采摘测试
- `tests/tag-manager.test.mjs`：原生 message.extra 持久化测试
- `tests/story-outline.test.mjs`：主干分章聚合与 Markdown 序列化测试
- `tests/analytics.test.mjs`：中英文混合字数、角色天平与 Swipes 统计测试
- `tests/snapshots.test.mjs`：时光机检查点扫描、时序排序与过滤测试
- `tests/search-radar.test.mjs`：正则表达式语法、多维复合条件与调光逻辑测试
- `tests/authority-adapter.test.mjs`：Authority 接入状态机与最小权限嗅探测试
- `tests/embedding-provider.test.mjs`：embedding 批处理、文本哈希与熔断降级测试
- `tests/semantic-index.test.mjs`：externalId 编解码、payload 构建与增量 diff 测试
- `tests/semantic-search.test.mjs`：命中映射、跨会话结果格式化与混合检索测试
- `tests/incremental-merge.test.mjs`：id 级 diff 增量补丁测试
- `tests/load-progress.test.mjs`：进度胶囊阶段权重状态机测试
- `tests/memory-profile.test.mjs`：设备画像判定与文本截断测试
- `tests/node-text.test.mjs`：细腰图全文还原（含 swipe 变体）测试
- `tests/layout-service.test.mjs`：Worker 布局服务优雅降级测试

### 6.3 基于 Chrome DevTools Protocol (CDP) 端到端自动化验证
在本地真实酒馆/Luker 实例运行环境下，测试脚本可通过 Chrome 调试协议直接验证 UI 渲染与功能交互：
- `luker_timelines_story_outline_verified.png`：验证故事大纲章节导航与卡片流
- `luker_timelines_analytics_verified.png`：验证全景数据看板与发言天平柱状图
- `luker_timelines_snapshots_verified.png`：验证时光机存档画廊与时空穿越
- `luker_timelines_radar_verified.png`：验证搜索雷达步进器与多维过滤面板
- `luker_timelines_export_modal.png`：验证 4K/8K 超大画幅导出配置

---
*文档维护：SillyTavern-Timelines 架构组 · 遵循 MIT 开放许可协议*
