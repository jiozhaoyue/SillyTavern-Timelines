# Journal - jiozhaoyue (Part 1)

> AI development session journal
> Started: 2026-09-01

---



## Session 1: 全链路性能重构与 Luker 规范适配实机集成
<!-- trellis-session: v=2 fp=ccd426993b9966ca -->

**Date**: 2026-09-04
**Task**: 全链路性能重构与 Luker 规范适配实机集成
**Branch**: `codex-luker-chinese-refactor`

### Summary

完成大 JSONL 增量缓存、算法解耦去重与 O(1) 回溯、Worker 异步 Dagre 布局，并完成 Luker 前端插件规范适配与 8003 实机自动化测试验证。

### Git Commits

| Hash | Message |
|------|---------|
| `c62ac52` | feat(perf): 全链路性能重构与算法优化 |
| `ff502c9` | feat(luker): 适配 Luker 前端插件规范与实机集成 |
| `7200114` | chore(task): archive 09-04-timeline-perf-overhaul |

### Status

[OK] **Completed**


## Session 2: 节点右键分支管理与多分支 Diff 对比开发
<!-- trellis-session: v=2 fp=bed09d32e4851f73 -->

**Date**: 2026-09-04
**Task**: 节点右键分支管理与多分支 Diff 对比开发
**Branch**: `codex-luker-chinese-refactor`

### Summary

严格基于酒馆原生能力（bookmarks.js 与 script.js）实现了节点右键一键创建分支、删除分支、LCA 分叉点计算与双栏毛玻璃 Diff 对比视图，并在 Luker 实机与 CDP 自动化测试中成功验证。

### Git Commits

| Hash | Message |
|------|---------|
| `00a78ac` | feat(branch): 添加节点右键原生分支管理与多分支 Diff 差异对比 |
| `6ae4a17` | chore(task): archive 09-04-timeline-branch-management |

### Status

[OK] **Completed**


## Session 3: 移动端手势优化与小屏响应式适配
<!-- trellis-session: v=2 fp=61507f5b66b4702d -->

**Date**: 2026-09-04
**Task**: 移动端手势优化与小屏响应式适配
**Branch**: `codex-luker-chinese-refactor`

### Summary

优化 Cytoscape 移动端触控容错阈值与禁用框选冲突，通过 touch-action: none 解决捏合缩放劫持，实现长按呼出上下文菜单与顶栏控件及 Diff 弹窗的移动端响应式排版。

### Git Commits

| Hash | Message |
|------|---------|
| `f5e9bbf` | feat(mobile): 优化移动端双指缩放、触控长按菜单与响应式小屏布局 |
| `84abff4` | chore(task): archive 09-04-timeline-mobile-gestures |

### Status

[OK] **Completed**


## Session 4: 完成时间树全景小地图与鸟瞰拖拽导航 (09-05-timeline-minimap-navigation)
<!-- trellis-session: v=2 fp=99ad188fabe72714 -->

**Date**: 2026-09-05
**Task**: 完成时间树全景小地图与鸟瞰拖拽导航 (09-05-timeline-minimap-navigation)
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现了顶部折叠式全景小地图抽屉组件，集成高保真双缓冲 Canvas 渲染、视口取景框联动与拖拽居中平移，修复了 convertToCytoscapeElements 与 Worker postMessage 序列化，完成实机 1807 节点自动化 CDP 验证。

### Main Changes

- 实现 src/minimap-math.js 纯数学投影转换与视口取景框几何计算
- 实现 src/minimap.js 顶部折叠抽屉与双缓冲离屏拓扑渲染
- 在 style.css 与 settings.html 增加顶部折叠抽屉美化样式与地图切换按钮
- 修复 src/node-data.js 与 src/graph-builder.js 中的 convertToCytoscapeElements 导出
- 修复 src/layout-service.js 中的 postMessage 序列化（过滤不可克隆函数）

### Git Commits

| Hash | Message |
|------|---------|
| `c7380b7` | feat(minimap): 添加顶部折叠式时间树全景小地图与鸟瞰视口导航 |

### Testing

- [OK] 自动化单元测试 30/30 项全绿 (tests/*.test.mjs)
- [OK] CDP 实机自动化测试通过，成功在 1807 节点图上展开小地图、验证像素渲染 (101760 像素全部有效)、执行点击跳转导航与截图

### Status

[OK] **Completed**

### Next Steps

- 头脑风暴下一阶段功能（如：智能分支标签、全文搜索结果聚类与多路线导出等）


## Session 5: 时间树与 Luker 记忆图 (memory-graph) 主动深度联动与 API 暴露
<!-- trellis-session: v=2 fp=d958baddb44d4b3c -->

**Date**: 2026-09-05
**Task**: 时间树与 Luker 记忆图 (memory-graph) 主动深度联动与 API 暴露
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现时间树与 Luker 官方 memory-graph 扩展的主动双向联动与状态感知，暴露 timelines 扩展查询 API，并通过 37 项单元测试及 CDP 实机端到端验证。

### Main Changes

- 新增 src/memory-graph-service.js：实现 memory-graph 扩展总线发现、注入状态计算与安全优雅降级
- 新增 src/api.js：暴露 timelines 标准扩展查询接口 (LCA、Lineage、Tree、Branch)
- 增强 UI 与右键菜单：节点记忆徽章、Tap 记忆卡片、右键查看/补录记忆模态框、记忆里程碑过滤按钮

### Git Commits

| Hash | Message |
|------|---------|
| `50e6186` | feat(memory-graph): 时间树与 Luker 记忆图 (memory-graph) 主动深度联动与 API 暴露 |

### Testing

- [OK] 通过 37/37 项全量单元测试 (node --test tests/*.test.mjs)
- [OK] 通过 Chrome CDP 在 live Luker (https://127.0.0.1:8003) 完成端到端 UI 与 API 验证

### Status

[OK] **Completed**

### Next Steps

- 根据用户规划推进下一阶段需求


## Session 6: 超大时间树 LOD 分层抽稀与视口动态剔除性能优化
<!-- trellis-session: v=2 fp=fca842cfa760702b -->

**Date**: 2026-09-05
**Task**: 超大时间树 LOD 分层抽稀与视口动态剔除性能优化
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现双轨驱动的 LOD 性能引擎：包含拓扑长单链自适应抽稀折叠、关键节点绝对保护、远景连线算法动态降级为直线、以及丰富的工具栏与交互展开支持。全量 43 项单元测试与实机 CDP 验证通过。

### Main Changes

- 新增 src/lod-service.js：纯算法实现连续单链拓扑分析、受保护节点（根/叶/分叉/记忆/书签/当前节点）过滤以及合成折叠节点与代理边生成
- 修改 src/style.js 与 style.css：实现折叠胶囊节点视觉样式（round-rectangle 虚线框）、.lod-macro 极简连线样式与顶栏快捷按钮
- 修改 index.js、timeline.html 与 settings.html：完成防抖 zoom 监听降级连线、单击胶囊局部平滑展开、顶栏快捷开关与设置项联动

### Git Commits

| Hash | Message |
|------|---------|
| `256bb85` | feat(lod): 超大时间树 LOD 分层抽稀与视口动态剔除性能优化 |

### Testing

- [OK] 通过全量 43/43 项单元测试 (node --test tests/*.test.mjs)
- [OK] 通过 Chrome CDP 在 live Luker 实例完成 Style LOD 切换、胶囊渲染、按钮切换与实机截图验证

### Status

[OK] **Completed**

### Next Steps

- 根据用户规划推进下一阶段需求（如时间树节点自定义书签与标签系统、高清画幅导出等）


## Session 7: 通用扩展装饰器架构解耦与原生书签彩色标签系统
<!-- trellis-session: v=2 fp=dda75260f22a1884 -->

**Date**: 2026-09-05
**Task**: 通用扩展装饰器架构解耦与原生书签彩色标签系统
**Branch**: `codex-luker-chinese-refactor`

### Summary

将 Timelines 彻底解耦为微内核拓扑引擎，移出硬编码 memory-graph 依赖至独立适配器；严格基于酒馆原生契约实现节点彩色标签与书签系统及顶部索引抽屉。

### Main Changes

- 新增 src/api.js 扩展总线：registerNodeDecorator, registerToolbarAction, registerContextMenuAction
- 新增 src/adapters/memory-graph-adapter.js：实现外部记忆图谱独立即插即用适配器
- 新增 src/tag-manager.js：实现酒馆原生 message.extra.tags 持久化与 TagsDrawer 顶部卡片抽屉
- 修改 index.js、timeline.html、settings.html 与 style.css：完成动态修饰器执行、顶栏开关与半透明毛玻璃样式

### Git Commits

| Hash | Message |
|------|---------|
| `f796361` | feat(tags): 通用扩展装饰器架构解耦与原生书签彩色标签系统 |
| `b736781` | chore(task): archive 09-05-timeline-decoupling-bookmarks-tags |

### Testing

- [OK] 通过全量 49/49 项自动化单元测试 (node --test tests/*.test.mjs)
- [OK] 通过 Chrome CDP 在 live Luker (8003) 完成书签标签保存、抽屉卡片渲染、平滑定位与截图验证

### Status

[OK] **Completed**


## Session 8: Session 8: 超大画幅高保真导出与长图分享系统
<!-- trellis-session: v=2 fp=dd7d5b7094130680 -->

**Date**: 2026-09-05
**Task**: Session 8: 超大画幅高保真导出与长图分享系统
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现超大画幅长图海报与无损矢量SVG导出系统，支持自适应安全缩放防爆内存、离线元数据水印底栏合成、居中毛玻璃配置对话框、剪贴板写入与文件直接下载

### Main Changes

- 新增 export-service.js 实现 calculateSafeScale, composeMetadataBanner, exportTimelineAsPng 与无依赖 SVG 矢量生成器
- 新增 export-modal.js 实现 timelines-export-backdrop 居中配置弹窗，支持 4 种规格、全卷/视口与背景底色切换
- 更新 timeline.html, settings.html, style.css, index.js 增加 .export-timeline-btn 顶栏相机按钮与右键导出动作

### Git Commits

| Hash | Message |
|------|---------|
| `71ddc46` | feat(export): 超大画幅高保真导出与长图分享系统 |
| `2fce04f` | chore(task): archive 09-05-timeline-export-sharing |

### Testing

- [OK] 全量 54 项 Node.js 单元测试 100% 通过 (54/54 passed)
- [OK] 通过 Chrome CDP 连接本地 Luker 实例端到端实机验证模态框弹出与 PNG/SVG 渲染，并留存高清截图

### Status

[OK] **Completed**

### Next Steps

- 根据用户进一步需求，规划时间线分支折叠归档导出或更多剧本卡片分享玩法


## Session 9: Session 9: 分支剧情树深度差异化分析与一键跨分支合并
<!-- trellis-session: v=2 fp=dddfaefede53b91c -->

**Date**: 2026-09-05
**Task**: Session 9: 分支剧情树深度差异化分析与一键跨分支合并
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现分支剧情树深度差异化分析、逐轮对齐、关键指标统计、单消息卡片一键采摘 (Cherry-Pick) 与基于分叉点 LCA 派生合并新会话系统，100% 遵从酒馆原生消息规范

### Main Changes

- 新增 merge-service.js 实现 cloneNativeMessage, cherryPickMessageToCurrentChat, synthesizeMergedChatSequence 与 generateMergeBranchName
- 重构 diff-modal.js 增加统计指标栏、双栏单消息 Cherry-Pick 采摘按钮与反馈动效、基于 LCA 派生合并分支流程
- 更新 style.css 为差异对比浮层增加 Cherry-Pick 采摘微动效、合并按钮与统计指标样式

### Git Commits

| Hash | Message |
|------|---------|
| `9f23805` | feat(diff-merge): 分支剧情树深度差异化分析与一键跨分支合并 |
| `f0d17fc` | chore(task): archive 09-05-branch-diff-merge |

### Testing

- [OK] 全量 60 项 Node.js 单元测试 100% 通过 (60/60 passed，新增 tests/merge.test.mjs)
- [OK] 通过 Chrome CDP 连接本地 Luker 实例端到端实机验证 Diff 面板唤起与单消息采摘至第 5 楼，并留存高清截图

### Status

[OK] **Completed**

### Next Steps

- 探索基于时间线的故事大纲全局视图、剧情关键节点摘要与更多智能化排版功能


## Session 10: Session 10: 时间线全局故事大纲视图与关键剧情摘要卡片流导出
<!-- trellis-session: v=2 fp=a80c07b39f412b45 -->

**Date**: 2026-09-05
**Task**: Session 10: 时间线全局故事大纲视图与关键剧情摘要卡片流导出
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现主线故事大纲智能分章聚合提取、剧情卡片流与双向视口脉冲聚焦联动、GFM Markdown 导出与下载功能

### Main Changes

- 新增 src/story-outline-service.js 实现分章聚合、主干追踪与 Markdown 序列化
- 新增 src/story-outline-modal.js 实现章节导航侧边栏、卡片流双向脉冲聚焦与导出
- 在 timeline.html, settings.html, src/context-menu.js, style.css 增加故事大纲入口与响应式样式

### Git Commits

| Hash | Message |
|------|---------|
| `8b24021` | feat(outline): 时间线全局故事大纲视图与关键剧情摘要卡片流导出 |
| `8d11c6d` | chore(task): archive 09-05-story-outline-summary |

### Testing

- [OK] 全量 64 项单元测试 100% 通过 (tests/story-outline.test.mjs)
- [OK] 通过 Chrome CDP 在 Luker 实例端到端自动化验证大纲弹窗交互并截留验证图 luker_timelines_story_outline_verified.png

### Status

[OK] **Completed**

### Next Steps

- 继续按 /goal 自主交付规划：推进全景数据指标统计看板、时光机快照管理与智能检索雷达


## Session 11: Session 11: 剧情分支深度量化统计与全景数据看板
<!-- trellis-session: v=2 fp=0dbaedd6c289728b -->

**Date**: 2026-09-05
**Task**: Session 11: 剧情分支深度量化统计与全景数据看板
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现全景拓扑量化指标计算、对白发言天平与角色分布、Swipes 探索深度度量、高频剧情标签分布与一键导出 Markdown/JSON 数据看板

### Main Changes

- 新增 src/analytics-service.js 实现拓扑结构与发言量化计算函数
- 新增 src/analytics-modal.js 实现玻璃拟态数据看板、KPI 卡片与导出动作
- 在 timeline.html, settings.html, src/context-menu.js, style.css 增加全景数据入口与响应式样式

### Git Commits

| Hash | Message |
|------|---------|
| `c926fdb` | feat(analytics): 剧情分支深度量化统计与全景数据看板 |
| `0316f61` | chore(task): archive 09-05-timeline-analytics |

### Testing

- [OK] 全量 69 项单元测试 100% 通过 (tests/analytics.test.mjs)
- [OK] 通过 Chrome CDP 在 Luker 实例端到端自动化验证数据看板渲染并截留验证图 luker_timelines_analytics_verified.png

### Status

[OK] **Completed**

### Next Steps

- 继续按 /goal 自主推进：时光机快照与分支存档管理 (branch-snapshots)


## Session 12: Session 12: 分支检查点快照与时光机存档画廊管理
<!-- trellis-session: v=2 fp=324dc5650e3fd4f0 -->

**Date**: 2026-09-05
**Task**: Session 12: 分支检查点快照与时光机存档画廊管理
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现全时间树书签与关键分歧快照自动扫描聚合、时光机画廊纵向时间轴展示、模糊搜索过滤、视口节点极速跳跃聚焦与跨分支会话时空穿越

### Main Changes

- 新增 src/snapshot-service.js 实现快照提取、排序、过滤与 Markdown 导出
- 新增 src/snapshot-modal.js 实现玻璃拟态时光机卡片流、视口定位与 openCharacterChat 穿越
- 在 timeline.html, settings.html, src/context-menu.js, style.css 增加时光机入口与样式

### Git Commits

| Hash | Message |
|------|---------|
| `cc4db83` | feat(snapshots): 分支检查点快照与时光机存档画廊管理 |
| `294b9f8` | chore(task): archive 09-05-branch-snapshots |

### Testing

- [OK] 全量 74 项单元测试 100% 通过 (tests/snapshots.test.mjs)
- [OK] 通过 Chrome CDP 在 Luker 实例端到端自动化验证时光机画廊渲染并截留验证图 luker_timelines_snapshots_verified.png

### Status

[OK] **Completed**

### Next Steps

- 继续按 /goal 自主推进：智能全景雷达与多维复合检索器 (smart-search-radar)


## Session 13: Session 13: 智能全景雷达与多维复合检索器
<!-- trellis-session: v=2 fp=f758fe67fbfa7cd9 -->

**Date**: 2026-09-05
**Task**: Session 13: 智能全景雷达与多维复合检索器
**Branch**: `codex-luker-chinese-refactor`

### Summary

实现支持正则表达式、角色切片、书签、彩色标签、Swipes 重试与楼层范围的多维复合检索器，并提供步进器遍历跳跃、全图半透明调光与发光脉冲聚焦

### Main Changes

- 新增 src/search-service.js 纯函数实现正则解析与复合过滤算法
- 新增 src/search-radar.js 实现悬浮步进器、结果计数徽章、筛选气泡面板与视口脉冲调度
- 在 src/context-menu.js, style.css, index.js 增加雷达控制条样式、快捷键聚焦与调光样式

### Git Commits

| Hash | Message |
|------|---------|
| `2a7c69b` | feat(search): 智能全景雷达与多维复合检索器 |
| `22614f3` | chore(task): archive 09-05-smart-search-radar |

### Testing

- [OK] 全量 78 项单元测试 100% 通过 (tests/search-radar.test.mjs)
- [OK] 通过 Chrome CDP 在 Luker 实例端到端自动化验证搜索框与复合筛选面板弹出并截留验证图 luker_timelines_radar_verified.png

### Status

[OK] **Completed**

### Next Steps

- 完成项目终极全景功能文档 Wiki (WIKI.md 与 docs/) 并做最终交付


## Session 14: Authority 服务端集成：语义索引与跨会话搜索
<!-- trellis-session: v=2 fp=e908adb6553aabdc -->

**Date**: 2026-09-13
**Task**: Authority 服务端集成：语义索引与跨会话搜索
**Branch**: `codex-luker-chinese-refactor`

### Summary

通过可选接入 ST-Delegation-of-authority：authority-adapter 状态机与最小权限嗅探、Trivium 增量语义索引（externalId=chatFile::messageId，content_hash diff）、searchHybrid 语义搜索接入雷达（当前图重排 + 跨会话弹窗穿越）、embedding provider 熔断降级；默认零依赖零行为变化；沉淀 optional-integration spec（Node 可测模块约定 + 可选插件接入范式）

### Git Commits

| Hash | Message |
|------|---------|
| `a98d46f` | feat(semantic): Authority 服务端集成——语义索引/检索纯逻辑模块与适配器 |
| `5f91736` | feat(semantic): 雷达语义模式、跨会话结果弹窗与设置面板接线 |
| `eeef418` | docs(spec): 沉淀可选外部插件接入与 Node 可测模块规范 |

### Status

[OK] **Completed**


## Session 15: 极端内存优化与渐进式渲染：画布先行+后台加载+全程进度
<!-- trellis-session: v=2 fp=fe5ef4db1bd71b7c -->

**Date**: 2026-09-13
**Task**: 极端内存优化与渐进式渲染：画布先行+后台加载+全程进度
**Branch**: `codex-luker-chinese-refactor`

### Summary

画布先行（无全屏 loader，空骨架即开）、prepareDataProgressive 单文件粒度后台管线（活跃会话先行/缓存分块回放/网络逐文件回调）、600ms 节流 rebuild + id 级 diff 增量补丁上屏、常驻进度胶囊（阶段权重百分比+实时文件名，完成淡出/失败红态）；细腰图：设备画像自动判定（weak→160 字预览+并发 4）、swipe 文本截断、getFullNodeText 按需全文、msgTruncated 卡片提示与 zoom 前缀匹配；默认档位 graph-builder 输出逐字节不变，110/110 测试全绿

### Git Commits

| Hash | Message |
|------|---------|
| `3b1220c` | feat(perf): 渐进式渲染管线——画布先行、增量补丁与全程进度条 |
| `9fe18c6` | feat(perf): 细腰图内存极压——设备画像、文本预览与渐进数据管线 |

### Status

[OK] **Completed**


## Session 16: 仓库卫生修复与细腰图展开全文功能
<!-- trellis-session: v=2 fp=1e3b3e8150b0f2ae -->

**Date**: 2026-09-19
**Task**: 仓库卫生修复与细腰图展开全文功能
**Branch**: `codex-luker-chinese-refactor`

### Summary

仓库卫生（gitignore/解除 .codex 跟踪/清理重复文件/还原回归改动）＋ 细腰图展开全文功能落地 ＋ WIKI/README 文档补齐

### Main Changes

### Summary

仓库卫生修复（.gitignore/解除 .codex 跟踪/清理重复文件/还原 layout-service 回归改动）＋ 细腰图「展开全文」功能落地（接通死代码 getFullNodeText、补齐 swipe 变体还原）＋ WIKI/README 文档补齐 Session 14/15 特性

### Main Changes

- 新增根目录 .gitignore（忽略 .history/.codex/.claude/.cursor、验证截图与运行时缓存）；git rm --cached 移除误提交的 24MB Chrome profile（348 文件）；删除根目录 13 个与 vendor/ 完全相同的库副本与 5 个无引用 tl_* 垫片；提交 Trellis 初始化脚手架与 .gitattributes
- 还原 src/layout-service.js 中未提交的回归改动（重复 postMessage + 未过滤函数的原始 layoutOptions 会导致 DataCloneError）
- 新增 src/node-text.js 纯函数模块：从 IndexedDB 缓存消息解析节点全文（普通节点取楼层 mes，swipe 节点还原 swipes[swipeId] 变体），Node 可测
- src/node-data.js getFullNodeText 改用统一解析器；index.js 节点详情面板将静态截断提示替换为「展开全文/收起」交互按钮（加载态 + 失败回退 + 保留搜索高亮）
- WIKI.md 新增 3.6 渐进式渲染与细腰图、4.13 语义检索（可选 Authority）章节，目录树补 9 模块，测试矩阵 78+ → 118+；README 功能矩阵补 2 条特性
- 确认 ST 的 context.characterId 为字符串化索引（"0" 为真值），现有 isGroupChat 判定无误，未做无谓改动

### Testing

- [OK] 全量 118 项单元测试 100% 通过（新增 tests/node-text.test.mjs 8 项）
- [OK] node --check index.js 语法校验通过

### Next Steps

- 可选迭代：iOS 移动端点击 TODO、边标签（edge labels）、更多上下文菜单项（index.js 顶部遗留 TODO 清单）


### Git Commits

| Hash | Message |
|------|---------|
| `316b3d9` | chore(repo): 仓库卫生——补 .gitignore、解除 .codex 浏览器配置跟踪、删除根目录重复文件 |
| `c917719` | feat(ux): 细腰图节点详情面板就地展开全文——接通按需全文解析并补齐 swipe 变体还原 |
| `c7ba1cb` | docs(wiki): 补齐渐进式渲染/细腰图与语义检索文档——WIKI 3.6 与 4.13 章节、测试矩阵 118+、README 功能矩阵 |

### Status

[OK] **Completed**


## Session 17: 复制消息全文——右键菜单与详情面板剪贴板支持
<!-- trellis-session: v=2 fp=5991fa6cab408c04 -->

**Date**: 2026-09-19
**Task**: 复制消息全文——右键菜单与详情面板剪贴板支持
**Branch**: `codex-luker-chinese-refactor`

### Summary

右键菜单「复制消息全文」+ 详情面板「复制全文」按钮 + Clipboard 工具函数（含回退），补齐更多上下文菜单选项 TODO

### Main Changes

### Summary

右键菜单与节点详情面板支持复制消息全文：新增 Clipboard 工具（含非安全上下文回退）、菜单项与面板按钮，补齐 index.js 遗留 TODO「更多上下文菜单选项」

### Main Changes

- 审计 src/load-progress.js、src/incremental-merge.js 与雷达语义模式接线，确认无阻断缺陷
- src/utils.js 新增 copyTextToClipboard：Clipboard API 优先，非安全上下文（http 部署/旧 WebView）回退 textarea + execCommand
- src/context-menu.js 新增「📋 复制消息全文」菜单项：经 getFullNodeText 解析楼层原文（swipe 节点复制对应变体，细腰图截断节点还原全文）
- index.js 节点详情面板「展开全文」旁新增「📋 复制全文」按钮（已复制/失败反馈 + 1.5s 复位）
- WIKI 4.3/3.6 与 README 交互说明同步更新

### Testing

- [OK] 全量 118 项单元测试 100% 通过
- [OK] node --check 校验 index.js / src/utils.js / src/context-menu.js 通过

### Next Steps

- 剩余 TODO 候选：iOS 移动端点击验证、边标签 (edge labels)、实验性多树视图


### Git Commits

| Hash | Message |
|------|---------|
| `d6714e4` | feat(ux): 右键菜单与详情面板支持复制消息全文——补齐上下文菜单选项 TODO |

### Status

[OK] **Completed**


## Session 18: 行为审计修复轮：tooltip 泄漏/字段错位/全文消费链贯通
<!-- trellis-session: v=2 fp=42b8af6b6b87dbeb -->

**Date**: 2026-09-19
**Task**: 行为审计修复轮：tooltip 泄漏/字段错位/全文消费链贯通
**Branch**: `codex-luker-chinese-refactor`

### Summary

tooltip DOM 泄漏与 hover 缓存、LOD 跨角色残留、三处字段错位（检索/语义/筛选）修复与全文解析注入

### Main Changes

### Summary

系统性行为审计修复轮：tooltip DOM 累积泄漏、LOD 展开集合跨角色残留、hover 重复 Markdown 转换、空文本节点 "undefined"，以及三处 fixture 形状掩盖的严重字段错位（雷达检索/语义索引/楼层筛选从未在真实数据上生效）

### Main Changes

- tooltip 生命周期：四条路径（node/edge mouseout、tap 预检、closeTapTippy）此前只 hide 不 destroy，popper（appendTo: body）永久残留；新增 destroyElementTippy 统一销毁，renderCytoscapeDiagram 销毁旧图前清理
- hover 性能：truncateMessage 提升为模块级 + hoverTooltipFormatCache（WeakMap 按 msg 缓存 Markdown 结果），悬停不再重跑 showdown
- 详情面板空文本节点显示友好占位；清理 context-menu 未使用导入
- LOD：expandedClusterIds 随上下文 key 变化清空（跨角色 clusterId 同构误命中）
- 严重字段错位（单测 fixture 用 message/depth/swipes 掩盖）：
  - search-service matchesNode 文本匹配 → 真实字段 msg；重试筛选 → totalSwipes/isSwipe；楼层筛选 → chat_depth（此前词法检索只命中名字标签、重试与楼层筛选从未生效）
  - semantic-index getNodeText → msg（此前把 externalId 当正文向量化、指纹不含正文）
  - SemanticIndexer 注入 resolveFullText（resolveEntryFullTexts 按节点去重解析全文），省内存模式向量质量与指纹不受影响；index.js 传 getFullNodeText
- extractStoryOutline 支持 fullTextMap，大纲弹窗预解析截断节点全文；旧版搜索确认读 msg 无需修复

### Testing

- [OK] 全量 124 项单元测试 100% 通过（新增 6 项回归测试覆盖真实节点形状）
- [OK] node --check 全部改动文件通过

### Next Steps

- 雷达语义模式的跨会话弹窗在 Authority 未建索引时的空结果提示
- 边标签 TODO（低价值，可评估后关闭）；实验性多树视图（大特性）


### Git Commits

| Hash | Message |
|------|---------|
| `5084206` | fix(perf): hover 提示按 msg 内容缓存格式化结果；修复空文本节点详情面板渲染 "undefined" |
| `4e98cb9` | fix(memory): 修复 tooltip popper 在 body 上永久残留的 DOM 累积泄漏 |
| `1267ffd` | fix(lod): 切换角色/群组后清空手动展开集合，避免跨上下文状态残留 |
| `57cb0d9` | fix(critical): 修复检索与语义索引读取真实图节点的字段错位——msg 消费链路贯通全文解析 |
| `064f281` | fix(search): 雷达重试与楼层筛选适配真实图谱节点形状——totalSwipes/isSwipe/chat_depth |

### Status

[OK] **Completed**


## Session 19: Authority 集成对齐审计与最小权限修正（L4 任务闭环）
<!-- trellis-session: v=2 fp=7d9014f43a1147fb -->

**Date**: 2026-09-25
**Task**: Authority 集成对齐审计与最小权限修正（L4 任务闭环）
**Branch**: `codex-luker-chinese-refactor`

### Summary

适配层 vs Authority 仓 API 面逐字段核验全一致；修正 L1-MF-5 多余权限声明；API 对齐矩阵沉淀 spec；trellis 任务回填-启动-归档闭环

### Main Changes

### Summary

响应用户裁定（本轮范围 = 与后端插件 ST-Delegation-of-authority 结合）：完成适配层与 Authority 仓真实 API 面的逐字段对齐审计——全部一致；唯一差异是 L1-MF-5 违规（声明了未使用的 storage.kv/jobs 权限），已修正。Trellis 任务 09-24-l4-timeline-enhancement 回填 PRD→启动→归档闭环

### Main Changes

- 核验基准：Authority 仓 fca5329 的 packages/shared-types/{session,permissions,trivium,sql,common}.ts 与 packages/sdk-extension/{index,sdk,client}.ts
- 核验结果：window.STAuthority.AuthoritySDK 挂载、init 配置形状（extensionId 模式 third-party/<name>、installType 枚举、declaredPermissions schema）、12 个 client 方法（trivium×8 + sql×4）的请求/响应 DTO 字段全部一致，零错位
- 修复：AUTHORITY_DECLARED_PERMISSIONS 移除未使用的 storage.kv 与 jobs.background（Timelines 从未调用 jobs.*/storage.*，grep 证据）；测试补负断言
- 沉淀：spec/frontend/optional-integration.md §1.3 权限描述修正，新增 §3「Authority SDK API 对齐矩阵」（自包含、含 file:line 证据，宿主升级后的重对基线）
- 任务闭环：09-24-l4-timeline-enhancement PRD 回填（Acceptance Criteria 全勾）→ add-context ×4 → start → validate 通过 → archive/2026-09
- 原 PRD 候选处置：语义空结果提示经核查已存在（雷达三态 UX 俱全）关闭；边标签维持关闭；多树视图另立任务

### Testing

- [OK] 全量 124 项单元测试 100% 通过
- [OK] node --check 改动文件通过；task.py validate 全部通过

### Next Steps

- 实机 E2E（Dev Luker 实例 8003 + Authority 服务端）验证语义索引与跨会话穿越全链路
- 多树视图（跨角色/群组同屏）为下一个大特性候选，需 design.md


### Git Commits

| Hash | Message |
|------|---------|
| `a75bbd3` | fix(authority): 最小权限修正——移除未使用的 storage.kv 与 jobs.background 声明 |

### Status

[OK] **Completed**
