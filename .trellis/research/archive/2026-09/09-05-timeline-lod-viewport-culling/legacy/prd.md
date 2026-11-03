# PRD: 超大时间树 LOD 分层抽稀与动态视口性能优化

## 1. 目标与背景 (Goal & Background)

针对大型角色扮演、长篇故事或包含数百个分支、数千条消息的超大时间树，传统 Cytoscape 全量渲染与复杂 Taxi 连线在远景下会消耗大量 GPU 与 CPU，导致平移缩放帧率下降、视觉信息极度密集混乱。
本项目旨在实现**双轨驱动的 LOD（Level of Detail）性能引擎**：
1. **动态样式分级 (Style LOD)**：在远景（低缩放比）下动态简化边连线（将 CPU 密集的 Taxi 折角连线降级为直线 Straight）并精简节点外发光与双边框等装饰。
2. **智能线性链抽稀折叠 (Linear Chain Collapsing)**：对长序列无分叉单链自动折叠为可交互的摘要节点（如 `[+35 轮对话]`），点击或放大时平滑展开。
3. **关键节点绝对保护**：根节点、分叉点（入度/出度 > 1）、分支末端叶子节点、记忆事件绑定节点 (`has-memory`)、书签节点 (`isBookmark`) 以及当前选中会话活跃节点坚决不折叠。

---

## 2. 需求列表 (Requirements)

### R1: 纯算法线性链识别与折叠计算 (`src/lod-service.js`)
- 纯函数式图拓扑分析算法：
  - 输入：Cytoscape 节点与边原始数组 `elements`，以及配置参数 `{ minChainLength: 10, enabled: true, protectedNodeIds: Set }`。
  - 识别规则：一段连续有向路径 $v_1 \to v_2 \to \dots \to v_k$，若每个中间节点 $v_i$ 均满足 $\text{in-degree}(v_i) = 1$、$\text{out-degree}(v_i) = 1$、且不在保护集（非书签、无关联记忆、非当前节点、非 Swipe 首节点）中，且链长 $k \ge \text{minChainLength}$。
  - 折叠输出：将中间节点移除并替换为一个合成折叠节点（如 `id: "collapsed_v1_vk"`, `label: "+k 轮对话"`, `collapsedCount: k`），并重建首尾有向边。
  - 展开计算：支持按 ID 解开单条折叠链，或全量展开恢复原图。

### R2: 动态视觉样式 LOD (Style LOD) (`src/style.js` & `index.js`)
- 监听 Cytoscape 的 `zoom` 事件（防抖 100ms 触发）：
  - 当 `zoom < 0.3`（宏观远景）：自动为图容器或元素添加 `.lod-macro` 样式，连线切换为 `curve-style: 'straight'`，关闭复杂双重边框、隐藏次要徽章与装饰阴影。
  - 当 `zoom >= 0.3`（细节视口）：平滑恢复 `curve-style: 'taxi'` 与全部节点丰富装饰。

### R3: 交互式折叠控制与视觉感知
- 合成折叠节点具有专有视觉样式：
  - 药丸胶囊状（`shape: 'round-rectangle'`），内部文字标明折叠轮数（如 `+18 轮`），虚线边框或特殊指示色。
  - 点击折叠节点：自动平滑展开该区段并触发局部重排。
- 顶部工具栏快捷开关：
  - 新增按钮 `.toggle-lod-collapse`（图标 `fa-solid fa-compress` / `fa-expand`），一键在「全局抽稀折叠」与「全量展开」之间切换，附带 Toastr 提示。

### R4: 设置面板配置集成 (`settings.html` & `index.js`)
- 设置面板新增「LOD 性能优化」分栏：
  - 开关：`启用智能长链抽稀折叠 (enableLodCollapsing)`（默认 `true`）。
  - 滑块/输入：`长链最小折叠阈值 (lodMinChainLength)`（默认 `10`，范围 5~50）。
  - 开关：`启用远景连线简化 (enableStyleLod)`（默认 `true`）。
- 更改设置后即时更新时间树，无需刷新页面。

### R5: 原生数据契约与优雅降级
- 绝不篡改酒馆原生聊天文件或后端结构，折叠与展开仅在前端图形呈现层（Cytoscape elements）进行拓扑变换。
- 小图（总节点数低于阈值）自动保持全展开，不增加认知负担。

---

## 3. 验收标准 (Acceptance Criteria)

- [ ] `src/lod-service.js` 实现纯算法抽稀与折叠，并通过原生 Node.js 单元测试覆盖各种拓扑（长链、分支分叉、单节点、首尾保护、记忆/书签保护）。
- [ ] 在 500+ 节点的长链场景下，执行折叠后 Cytoscape 节点数显著下降，渲染元素减少 60% 以上。
- [ ] 宏观缩放时，连线由 Taxi 自动降级为 Straight，平移缩放无肉眼卡顿。
- [ ] 单击折叠节点能正确单链展开；点击顶部工具栏折叠按钮可在全局折叠/全量展开之间无缝切换。
- [ ] 保护机制严密：记忆节点 (`has-memory`)、书签节点、当前会话节点与分叉关键点 100% 保留，绝不遗漏。
- [ ] 全部自动化单元测试保持 100% Pass。
- [ ] 通过 Chrome CDP 在运行中的 Luker 实例上进行端到端实机验证并留存截图。
