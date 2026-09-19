import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeTextSnippet,
  extractStoryOutline,
  formatStoryOutlineMarkdown,
} from '../src/story-outline-service.js';

test('summarizeTextSnippet trims and truncates gracefully', () => {
  assert.equal(summarizeTextSnippet(''), '');
  assert.equal(summarizeTextSnippet(null), '');
  assert.equal(summarizeTextSnippet('   你好   世界   '), '你好 世界');
  const longText = '这是一段非常非常非常非常非常非常非常非常非常非常非常非常长的话，用于测试文本摘要截断功能是否正常运作。';
  const snippet = summarizeTextSnippet(longText, 20);
  assert.equal(snippet.length, 23); // 20 + '...'
  assert.ok(snippet.endsWith('...'));
});

test('extractStoryOutline handles empty or missing cytoscape gracefully', () => {
  const res1 = extractStoryOutline(null);
  assert.equal(res1.chapters.length, 0);
  assert.equal(res1.stats.totalEvents, 0);

  const mockEmptyCy = {
    nodes: () => [],
  };
  const res2 = extractStoryOutline(mockEmptyCy);
  assert.equal(res2.chapters.length, 0);
  assert.equal(res2.stats.totalEvents, 0);
});

test('extractStoryOutline correctly segments chapters and events from mock graph', () => {
  const rawData = [
    { id: 'n1', label: '1', name: 'User', is_user: true, msg: '我们进入密林。', depth: 0 },
    { id: 'n2', label: '2', name: 'Aria', is_user: false, msg: '小心，前面有魔兽的踪迹！', tags: [{ name: '关键线索', color: '#f59e0b' }], depth: 1 },
    { id: 'n3', label: '3', name: 'User', is_user: true, msg: '拔剑迎战！', depth: 2 },
  ];

  const mockNodes = [
    {
      id: () => 'n1',
      data: prop => prop ? rawData[0][prop] : rawData[0],
      outgoers: () => [{}],
      incomers: () => [],
    },
    {
      id: () => 'n2',
      data: prop => prop ? rawData[1][prop] : rawData[1],
      outgoers: () => [{}, {}], // 出度为 2，代表剧情分歧点！
      incomers: () => [{ source: () => mockNodes[0] }],
    },
    {
      id: () => 'n3',
      data: prop => prop ? rawData[2][prop] : rawData[2],
      outgoers: () => [],
      incomers: () => [{ source: () => mockNodes[1] }],
    },
  ];

  const mockCy = {
    nodes: filterFn => {
      if (!filterFn) return mockNodes;
      return mockNodes.filter(filterFn);
    },
    getElementById: id => mockNodes.find(n => n.id() === id) || null,
  };

  const mockContext = {
    characters: { '1': { name: 'Aria' } },
    characterId: '1',
    chatId: 'Chapter1_Forest.jsonl',
  };

  const outline = extractStoryOutline(mockCy, mockContext);
  assert.equal(outline.characterName, 'Aria');
  assert.equal(outline.stats.totalEvents, 3);
  assert.equal(outline.stats.userTurns, 2);
  assert.equal(outline.stats.charTurns, 1);
  assert.equal(outline.stats.totalForks, 1);
  assert.ok(outline.chapters.length >= 1);
});

test('formatStoryOutlineMarkdown outputs well-formed GitHub Flavored Markdown', () => {
  const sampleData = {
    characterName: '莉莉娅',
    chatName: '王都篇章',
    chapters: [
      {
        id: 'chapter-1',
        title: '第 1 幕 · 初遇王都',
        startFloor: 1,
        endFloor: 2,
        events: [
          {
            nodeId: 'n1',
            messageId: 1,
            senderName: 'User',
            isUser: true,
            textSnippet: '请问皇宫怎么走？',
            tags: [],
            isForkPoint: false,
            isBookmark: false,
          },
          {
            nodeId: 'n2',
            messageId: 2,
            senderName: '莉莉娅',
            isUser: false,
            textSnippet: '跟我来吧，顺着这条中央大道一直走就是。',
            tags: [{ name: '主线任务', color: '#10b981' }],
            isForkPoint: true,
            isBookmark: true,
          },
        ],
      },
    ],
    stats: {
      totalEvents: 2,
      totalChapters: 1,
      totalForks: 1,
      userTurns: 1,
      charTurns: 1,
      approxWords: 30,
    },
  };

  const md = formatStoryOutlineMarkdown(sampleData);
  assert.ok(md.includes('# 📜 《莉莉娅》因果时间线 · 全景故事大纲'));
  assert.ok(md.includes('## 📑 故事章节目录'));
  assert.ok(md.includes('第 1 幕 · 初遇王都'));
  assert.ok(md.includes('`#1` 👤 **用户**：'));
  assert.ok(md.includes('`#2` 🎭 **莉莉娅** 🔖[书签检查点] 🏷️`主线任务`：'));
  assert.ok(md.includes('⚡ **剧情分歧点**'));
  assert.ok(md.includes('## 📊 剧情统计看板'));
  assert.ok(md.includes('| 故事角色 | 莉莉娅 |'));
});

test('extractStoryOutline prefers fullTextMap entries for snippet and word counts', () => {
  const rawData = [
    { id: 'n1', name: 'User', is_user: true, msg: '开始。', depth: 0 },
    { id: 'n2', name: 'Aria', is_user: false, msg: '预览...', depth: 1 },
  ];
  const mockNodes = rawData.map((d, i) => ({
    id: () => d.id,
    data: prop => (prop ? d[prop] : d),
    outgoers: () => (i === 0 ? [{}] : []),
    incomers: () => (i === 1 ? [{ source: () => mockNodes[0] }] : []),
  }));
  const mockCy = {
    nodes: filterFn => (filterFn ? mockNodes.filter(filterFn) : mockNodes),
    getElementById: id => mockNodes.find(n => n.id() === id) || null,
  };
  const mockContext = { characters: { '1': { name: 'Aria' } }, characterId: '1', chatId: 'Main.jsonl' };

  const fullText = '这是被截断节点的完整全文内容，应当用于摘要与导出而不是预览。';
  const fullTextMap = new Map([['n2', fullText]]);
  const outline = extractStoryOutline(mockCy, mockContext, fullTextMap);

  const event = outline.chapters.flatMap(c => c.events).find(e => e.nodeId === 'n2');
  assert.ok(event, '事件应存在');
  assert.equal(event.fullText, fullText);
  assert.ok(event.textSnippet.includes('完整全文'));
  // 字数统计使用全文而非预览
  assert.ok(outline.stats.approxWords >= fullText.length);
});
