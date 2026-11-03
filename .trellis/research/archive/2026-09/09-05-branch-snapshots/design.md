# 分支检查点快照与时光机存档管理 Design

## 1. 数据结构设计
快照模型 `TimelineSnapshot`:
```js
{
  id: string,                 // 节点唯一 ID (e.g. "chat1.jsonl-15")
  nodeId: string,             // Cytoscape 节点 ID
  chatFile: string,           // 所属会话文件名
  messageId: number,          // 消息索引楼层 (0-based / 1-based)
  name: string,               // 说话人名称
  is_user: boolean,           // 是否为玩家
  title: string,              // 快照命名 (从 extra.snapshotTitle 或 tag 或首句摘要生成)
  previewText: string,        // 台词内容摘要
  tags: Array<{name, color}>, // 关联标签
  isBookmark: boolean,        // 是否为原生书签
  timestamp: string | null,   // 时间戳
}
```

## 2. 交互设计
1. 顶部工具栏时光机入口 `.toggle-branch-snapshots` (`fa-solid fa-clock-rotate-left`)。
2. 弹出时光机画廊 `.timelines-snapshots-dialog`:
   - 顶部搜索栏与统计摘要（共 N 处关键存档点）。
   - 左侧或主体为纵向时间轴流（卡片按楼层/时间拓扑排序）。
   - 每个卡片包含：
     - 分支所属标签（带彩色药丸）
     - 楼层索引 Badge
     - 快照标题与台词预览
     - 操作按钮组：
       - `定位节点` (点击卡片或定位按钮，平滑移动视口并高亮)
       - `穿越分支` (如果属于其他分支，调用 `openCharacterChat` 切换并跳转)
3. 节点右键菜单集成：
   - 增加 `tl-snapshot`：“⭐ 标记/编辑时光机快照”。
