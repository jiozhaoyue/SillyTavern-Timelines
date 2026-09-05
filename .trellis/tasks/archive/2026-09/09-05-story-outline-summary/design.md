# Technical Design: 时间线全局故事大纲视图与关键剧情摘要卡片流导出

## 1. 系统架构
```
┌────────────────────────────────────────────────────────┐
│                   Cytoscape Graph                      │
│            (theCy.nodes(), theCy.edges())              │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             src/story-outline-service.js               │
│  - extractStoryOutline(cy, context)                    │
│    -> 分支主干拓扑遍历                                 │
│    -> 章节分割算法 (基于分歧点与里程碑)               │
│    -> 关键事件提炼 (发言人、标签、台词提炼)           │
│  - formatStoryOutlineMarkdown(outlineData)             │
│  - downloadOutlineMarkdown(markdownText, filename)     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             src/story-outline-modal.js                 │
│  - openStoryOutlineModal(cy, context)                  │
│  - 左侧章节目录导航 / 右侧事件卡片流时间轴             │
│  - 动作：聚焦对应节点、复制 Markdown、下载 .md 文件   │
└────────────────────────────────────────────────────────┘
```

## 2. 章节划分算法设计 (Chapter Segmentation Heuristic)
章节分割采用确定性纯函数启发式：
1. **主干链 (Primary Trunk)**：优先选取当前活跃分支（包含当前会话消息）从根到叶的完整节点链。若存在分叉，将分叉点标记为“剧情转折点”。
2. **章节边界判定**：
   - 节点拥有书签（Bookmark）或包含“章节”、“主线”等重要标签；
   - 节点出度 > 1（分叉点，代表剧情重大分歧抉择）；
   - 连续对话超过固定跨度（如每 10-15 轮次划为一幕）；
3. **章节对象结构**：
```typescript
interface StoryChapter {
  id: string;
  title: string;
  depthStart: number;
  depthEnd: number;
  events: StoryEvent[];
}

interface StoryEvent {
  nodeId: string;
  messageId: number;
  senderName: string;
  isUser: boolean;
  textSnippet: string;
  tags: Array<{ name: string; color: string }>;
  isForkPoint: boolean;
  isBookmark: boolean;
}
```

## 3. Markdown 生成规范
输出标准的 GitHub Flavored Markdown：
- 标题包含角色名、生成时间与故事宏观统计；
- `## 章节名称`
- 时间轴使用无序列表 `- **[楼层] 角色名**: 台词摘要 🏷️ 标签`；
- 剧情分歧点使用引用块 `> [!NOTE] 剧情分歧点：此处派生了 N 个不同走向的分支`；
- 结尾附带统计摘要表。
