import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapHitsToNodes,
  formatGlobalResults,
  semanticSearch,
  SEMANTIC_TOP_K,
  SEMANTIC_HYBRID_ALPHA,
} from '../src/semantic-search-service.js';

const graphElements = [
  {
    data: {
      id: 'n1',
      message: '你走进了一座巨龙的城堡',
      name: 'User',
      is_user: true,
      chat_sessions: { 'branch-a.jsonl': { messageId: 0 } },
    },
  },
  {
    data: {
      id: 'n2',
      message: '城堡的大门缓缓开启',
      name: 'AI',
      is_user: false,
      chat_sessions: { 'branch-a.jsonl': { messageId: 1 }, 'branch-b.jsonl': { messageId: 4 } },
    },
  },
];

test('mapHitsToNodes matches hits to in-memory nodes and separates cross-session hits', () => {
  const hits = [
    { externalId: 'branch-a::1', score: 0.92, payload: { preview: '城堡的大门' } },
    { externalId: 'branch-a::0', score: 0.81, payload: { preview: '巨龙的城堡' } },
    { externalId: 'branch-c::7', score: 0.77, payload: { preview: '未打开的会话' } },
    { externalId: 'garbage', score: 0.5, payload: {} },
  ];

  const { matched, unmatched } = mapHitsToNodes(hits, graphElements);

  assert.equal(matched.length, 2);
  assert.equal(matched[0].node.data.id, 'n2'); // 按 hits 顺序（分数序）
  assert.equal(matched[0].hit.score, 0.92);
  assert.equal(matched[1].node.data.id, 'n1');
  assert.equal(unmatched.length, 2);
  assert.equal(unmatched[0].externalId, 'branch-c::7');

  // 空输入
  assert.deepEqual(mapHitsToNodes([], graphElements), { matched: [], unmatched: [] });
  assert.deepEqual(mapHitsToNodes(hits, []).matched, []);
});

test('mapHitsToNodes deduplicates multiple hits landing on the same node', () => {
  // n2 在 branch-a::1 与 branch-b::4 都存在，两条 hit 应去重到同一节点
  const hits = [
    { externalId: 'branch-a::1', score: 0.9, payload: {} },
    { externalId: 'branch-b::4', score: 0.8, payload: {} },
  ];
  const { matched, unmatched } = mapHitsToNodes(hits, graphElements);
  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 0);
});

test('formatGlobalResults builds sorted cross-session rows', () => {
  const hits = [
    {
      externalId: 'branch-c::2',
      score: 0.66,
      payload: { name: 'AI', is_user: false, preview: '远方的分支剧情', tags: ['伏笔'], bookmark: true },
    },
    {
      externalId: 'branch-d::10',
      score: 0.88,
      payload: { name: 'User', is_user: true, preview: '另一分支的高分命中' },
    },
    { externalId: 'broken', score: 0.99, payload: {} },
  ];

  const rows = formatGlobalResults(hits);
  assert.equal(rows.length, 2); // 无法解码的 hit 被丢弃
  assert.equal(rows[0].chatFile, 'branch-d'); // 分数降序
  assert.equal(rows[0].messageId, 10);
  assert.equal(rows[0].is_user, true);
  assert.deepEqual(rows[0].tags, []); // 无 tags 字段时为空数组
  assert.deepEqual(rows[1].tags, ['伏笔']);
  assert.equal(rows[1].bookmark, true);
  assert.deepEqual(formatGlobalResults([]), []);
});

test('semanticSearch embeds the query and forwards hybrid search parameters', async () => {
  const captured = {};
  const client = {
    trivium: {
      searchHybrid: async input => {
        Object.assign(captured, input);
        return [{ externalId: 'branch-a::0', score: 0.7, payload: {} }];
      },
    },
  };
  const provider = {
    embed: async texts => {
      assert.equal(texts.length, 1);
      return [[0.3, 0.4]];
    },
  };

  const hits = await semanticSearch({
    client,
    provider,
    database: 'tl_vec_2',
    queryText: '巨龙的城堡',
    namespace: 'char_1',
  });

  assert.equal(hits.length, 1);
  assert.deepEqual(captured.vector, [0.3, 0.4]);
  assert.equal(captured.queryText, '巨龙的城堡');
  assert.equal(captured.database, 'tl_vec_2');
  assert.equal(captured.topK, SEMANTIC_TOP_K);
  assert.equal(captured.hybridAlpha, SEMANTIC_HYBRID_ALPHA);
  assert.deepEqual(captured.payloadFilter, { namespace: 'char_1' });

  // 无 namespace 时不附加过滤
  await semanticSearch({ client, provider, database: 'tl_vec_2', queryText: 'x' });
  assert.equal(captured.payloadFilter, undefined);

  // 参数缺失快速失败
  await assert.rejects(() => semanticSearch({ provider, database: 'd', queryText: 'q' }));
  await assert.rejects(() => semanticSearch({ client, database: 'd', queryText: 'q' }));
  await assert.rejects(() => semanticSearch({ client, provider, database: 'd', queryText: '' }));
});
