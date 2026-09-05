import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countWordsAndChars,
  calculateTimelineStats,
  formatAnalyticsMarkdown,
  formatAnalyticsJson,
} from '../src/analytics-service.js';

test('countWordsAndChars handles pure CJK, English, mixed and empty strings', () => {
  assert.deepEqual(countWordsAndChars(''), { words: 0, chars: 0 });
  assert.deepEqual(countWordsAndChars(null), { words: 0, chars: 0 });

  // Pure English: 4 words
  const en = countWordsAndChars('Hello world from SillyTavern');
  assert.equal(en.words, 4);
  assert.equal(en.chars, 28);

  // Pure Chinese: 6 characters
  const cn = countWordsAndChars('你好世界，酒馆！');
  assert.equal(cn.words, 6);

  // Mixed: 2 English words ('AI', 'SillyTavern') + 5 Chinese chars ('角色扮演在') = 7 words
  const mixed = countWordsAndChars('AI 角色扮演在 SillyTavern');
  assert.equal(mixed.words, 7);
});

test('calculateTimelineStats handles null and empty graphs gracefully', () => {
  const empty = calculateTimelineStats(null);
  assert.equal(empty.totalNodes, 0);
  assert.equal(empty.branchPoints, 0);

  const emptyCollection = calculateTimelineStats({ nodes: () => [] });
  assert.equal(emptyCollection.totalNodes, 0);
  assert.equal(emptyCollection.speakers.user.turns, 0);
});

test('calculateTimelineStats computes linear dialogue metrics accurately', () => {
  const mockNodes = [
    {
      id: () => 'n0',
      data: () => ({
        id: 'n0',
        message: 'Hello traveler, welcome to the tavern.',
        is_user: false,
        depth: 0,
        swipes: ['Hello traveler, welcome to the tavern.'],
      }),
      incomers: () => [],
      outgoers: () => [{ id: 'e1' }],
    },
    {
      id: () => 'n1',
      data: () => ({
        id: 'n1',
        message: 'Thank you! What drinks do you have tonight?',
        is_user: true,
        depth: 1,
      }),
      incomers: () => [{ id: 'e1' }],
      outgoers: () => [{ id: 'e2' }],
    },
    {
      id: () => 'n2',
      data: () => ({
        id: 'n2',
        message: 'We have vintage elven wine and dwarven ale.',
        is_user: false,
        depth: 2,
        bookmark: true,
        extra: { tags: ['tavern', 'menu'] },
      }),
      incomers: () => [{ id: 'e2' }],
      outgoers: () => [],
    },
  ];

  const stats = calculateTimelineStats({ nodes: () => mockNodes });

  assert.equal(stats.totalNodes, 3);
  assert.equal(stats.rootNodes, 1);
  assert.equal(stats.leafNodes, 1);
  assert.equal(stats.branchPoints, 0);
  assert.equal(stats.maxBranchingFactor, 0);
  assert.equal(stats.maxDepth, 2);

  // Speakers: 1 user, 2 character
  assert.equal(stats.speakers.user.turns, 1);
  assert.equal(stats.speakers.character.turns, 2);
  assert.equal(stats.speakers.user.turnPercent, 33.3);
  assert.equal(stats.speakers.character.turnPercent, 66.7);

  // Milestones: 1 bookmark, 1 tagged node with 'tavern' and 'menu'
  assert.equal(stats.milestones.bookmarks, 1);
  assert.equal(stats.milestones.taggedNodes, 1);
  assert.equal(stats.milestones.topTags.length, 2);
});

test('calculateTimelineStats detects branching factors, swipes and ignores LOD clusters', () => {
  const mockNodes = [
    {
      id: 'root',
      data: {
        id: 'root',
        message: 'Root story opening',
        is_user: false,
        floor: 0,
        inDegree: 0,
        outDegree: 2, // branch point!
      },
    },
    {
      id: 'branchA',
      data: {
        id: 'branchA',
        message: 'Choice A path taken',
        is_user: true,
        floor: 1,
        inDegree: 1,
        outDegree: 0, // leaf A
        swipes: ['Choice A1', 'Choice A2', 'Choice A3'],
      },
    },
    {
      id: 'branchB',
      data: {
        id: 'branchB',
        message: 'Choice B path taken',
        is_user: true,
        floor: 1,
        inDegree: 1,
        outDegree: 0, // leaf B
      },
    },
    {
      id: 'lod-synthetic',
      data: {
        id: 'lod-synthetic',
        isCluster: true,
        message: 'Synthetic collapsed summary',
      },
    },
  ];

  const stats = calculateTimelineStats(mockNodes);

  // lod-synthetic should be ignored => 3 nodes
  assert.equal(stats.totalNodes, 3);
  assert.equal(stats.leafNodes, 2);
  assert.equal(stats.branchPoints, 1);
  assert.equal(stats.maxBranchingFactor, 2);
  assert.equal(stats.avgBranchingFactor, 2);

  // Swipes: branchA has 3 swipes => turnsWithSwipes = 1, maxSwipesOnTurn = 3
  assert.equal(stats.swipes.maxSwipesOnTurn, 3);
  assert.equal(stats.swipes.turnsWithSwipes, 1);
  assert.equal(stats.swipes.explorationRate, 33.3);
});

test('formatAnalyticsMarkdown and formatAnalyticsJson generate valid reports', () => {
  const stats = {
    totalNodes: 10,
    rootNodes: 1,
    leafNodes: 3,
    branchPoints: 2,
    maxBranchingFactor: 3,
    avgBranchingFactor: 2.5,
    maxDepth: 8,
    avgDepth: 4.2,
    content: { totalWords: 1500, totalChars: 3000, avgWordsPerTurn: 150 },
    speakers: {
      user: { turns: 5, words: 600, chars: 1200, avgWords: 120, turnPercent: 50, wordPercent: 40 },
      character: { turns: 5, words: 900, chars: 1800, avgWords: 180, turnPercent: 50, wordPercent: 60 },
      system: { turns: 0, words: 0, chars: 0, avgWords: 0, turnPercent: 0, wordPercent: 0 },
    },
    swipes: { totalSwipes: 14, maxSwipesOnTurn: 4, turnsWithSwipes: 3, explorationRate: 30 },
    milestones: { bookmarks: 2, taggedNodes: 3, topTags: [{ tag: 'boss', count: 2 }] },
  };

  const md = formatAnalyticsMarkdown(stats);
  assert.ok(md.includes('剧情时间树量化分析与全景研报'));
  assert.ok(md.includes('总剧情节点数'));
  assert.ok(md.includes('1500 字'));
  assert.ok(md.includes('#boss'));

  const jsonStr = formatAnalyticsJson(stats);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.totalNodes, 10);
  assert.equal(parsed.speakers.character.words, 900);
});
