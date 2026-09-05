# 剧情分支深度量化统计与全景数据看板 Design

## 1. 架构设计
- `calculateTimelineStats(cy)`:
  - 纯函数，接收 Cytoscape 实例或节点数组。
  - 遍历所有节点与边：
    - `totalNodes`: 真实节点总数（过滤 LOD 合并产生的合成节点，或统一按真实消息节点统计）。
    - `rootCount`: 入度为 0 的节点数。
    - `leafCount`: 出度为 0 的节点数（即剧情终点/结局分支数）。
    - `branchPointCount`: 出度 > 1 的节点数（分叉决策点）。
    - `maxBranchingFactor`: 单个节点最大分支子节点数。
    - `avgBranchingFactor`: 分叉节点的平均子分支数。
    - `maxDepth`: 根节点到叶节点的最长路径深度。
    - 说话人统计 (`speakerStats`):
      - `user`: 消息数、总字数、平均单条字数、占比。
      - `character`: 消息数、总字数、平均单条字数、占比。
      - `system`: 系统消息数、总字数。
    - Swipes 重试深度统计 (`swipeStats`):
      - 总 swipe 数量、最高 swipe 轮次、平均 swipe 深度。
    - 标签与书签统计 (`tagStats`):
      - 带标签/书签节点占比、标签词频 Top 10。
    - 时间跨度与活跃度:
      - 最早消息与最新消息时间（如有 send_date）。

## 2. 交互与 UI 设计
- 模态窗 `.timelines-analytics-modal`:
  - 继承高斯毛玻璃、圆角和阴影设计系统。
  - 4 个顶层 KPI 卡片:
    - 剧情消息总量 (Total Nodes)
    - 结局分支数 (Story Endings)
    - 最大剧情深度 (Max Depth)
    - 分支决策点数 (Branch Points)
  - 发言量与对话天平 (Dialogue Balance):
    - 双色对比条显示 User vs Character 字数比例与轮次比例。
  - Swipes 探索度与剧本复杂度指标:
    - 重试总次数、最大单轮重试、平均重试。
  - 标签与关键词高频分布云/徽章。
  - 底部操作栏:
    - "复制 Markdown 报告"
    - "下载 JSON 数据"
    - "关闭"
