import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapHitsToNodes,
  formatGlobalResults,
  semanticSearch,
  buildSemanticPayloadFilter,
  filterHitsByPayload,
  groupGlobalResultsByNamespace,
  fetchNeighborsForHits,
  expandHitWithContexts,
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

// ===================== Phase 1：A2 筛选构建 / 后过滤 =====================

test('buildSemanticPayloadFilter 仅承载服务端等值维度（namespace/bookmark），tags 不入 filter', () => {
  assert.equal(buildSemanticPayloadFilter({}), undefined);
  assert.deepEqual(buildSemanticPayloadFilter({ namespace: 'char_1' }), { namespace: 'char_1' });
  assert.deepEqual(buildSemanticPayloadFilter({ bookmark: true }), { bookmark: true });
  assert.deepEqual(buildSemanticPayloadFilter({ namespace: 'char_1', bookmark: true }), { namespace: 'char_1', bookmark: true });
  // 空 namespace 视为无过滤（跨角色全局）
  assert.equal(buildSemanticPayloadFilter({ namespace: '  ' }), undefined);
  assert.equal(buildSemanticPayloadFilter({ namespace: null, bookmark: false }), undefined);
});

test('filterHitsByPayload 客户端后过滤标签/说话人维度', () => {
  const hits = [
    { externalId: 'a::1', payload: { tags: ['战斗'], is_user: false } },
    { externalId: 'a::2', payload: { tags: [], is_user: true } },
    { externalId: 'a::3', payload: { tags: ['日常'], is_user: false } },
  ];
  assert.deepEqual(filterHitsByPayload(hits, {}).map(h => h.externalId), ['a::1', 'a::2', 'a::3']);
  assert.deepEqual(filterHitsByPayload(hits, { onlyTagged: true }).map(h => h.externalId), ['a::1', 'a::3']);
  assert.deepEqual(filterHitsByPayload(hits, { speakerFilter: 'user' }).map(h => h.externalId), ['a::2']);
  assert.deepEqual(filterHitsByPayload(hits, { speakerFilter: 'character' }).map(h => h.externalId), ['a::1', 'a::3']);
  // 组合 + 非法输入
  assert.deepEqual(filterHitsByPayload(hits, { onlyTagged: true, speakerFilter: 'user' }), []);
  assert.deepEqual(filterHitsByPayload(null, { onlyTagged: true }), []);
});

test('semanticSearch scope=global 时不附加 namespace 过滤，bookmark 进入 payloadFilter', async () => {
  const captured = {};
  const client = {
    trivium: {
      searchHybrid: async input => {
        Object.assign(captured, input);
        return [{ externalId: 'x::1', score: 0.9, payload: {} }];
      },
    },
  };
  const provider = { embed: async () => [[0.1, 0.2]] };

  await semanticSearch({ client, provider, database: 'tl_vec_2', queryText: 'q', namespace: 'char_1', scope: 'global' });
  assert.equal(captured.payloadFilter, undefined);

  await semanticSearch({ client, provider, database: 'tl_vec_2', queryText: 'q', bookmark: true });
  assert.deepEqual(captured.payloadFilter, { bookmark: true });
});

test('semanticSearch postFilter 生效时放大 topK 并在客户端过滤', async () => {
  const captured = {};
  const rawHits = [
    { externalId: 'a::1', score: 0.9, payload: { tags: ['战斗'], is_user: false } },
    { externalId: 'a::2', score: 0.8, payload: { tags: [], is_user: false } },
  ];
  const client = {
    trivium: {
      searchHybrid: async input => {
        captured.topK = input.topK;
        return rawHits;
      },
    },
  };
  const provider = { embed: async () => [[0.1]] };

  const hits = await semanticSearch({
    client,
    provider,
    database: 'tl_vec_1',
    queryText: 'q',
    topK: 10,
    postFilter: { onlyTagged: true },
  });
  assert.equal(captured.topK, 10 * 3); // SEMANTIC_POSTFILTER_TOPK_BOOST
  assert.deepEqual(hits.map(h => h.externalId), ['a::1']);
});

// ===================== Phase 1：A3 分组与来源字段 =====================

test('formatGlobalResults 携带 namespace/namespaceLabel 来源字段', () => {
  const rows = formatGlobalResults([
    { externalId: 'c1::5', score: 0.9, payload: { name: 'AI', namespace: 'char_1', namespaceLabel: '青' } },
    { externalId: 'c2::7', score: 0.8, payload: { name: 'AI', namespace: 'char_2' } }, // 旧条目无 label
  ]);
  assert.equal(rows[0].namespace, 'char_1');
  assert.equal(rows[0].namespaceLabel, '青');
  assert.equal(rows[1].namespaceLabel, null);
  assert.ok(rows[0].externalId, 'externalId 保留供上下文扩展');
});

test('groupGlobalResultsByNamespace 保持分数序并按 label 回退键名', () => {
  const rows = [
    { externalId: 'a::1', namespace: 'char_2', namespaceLabel: '蓝', score: 0.9 },
    { externalId: 'a::2', namespace: 'char_1', score: 0.8 },
    { externalId: 'a::3', namespace: 'char_2', namespaceLabel: '蓝', score: 0.7 },
    { externalId: 'a::4', score: 0.6 }, // 无 namespace → unknown
  ];
  const groups = groupGlobalResultsByNamespace(rows);
  assert.deepEqual(groups.map(g => g.key), ['char_2', 'char_1', 'unknown']);
  assert.equal(groups[0].label, '蓝');
  assert.equal(groups[1].label, 'char_1');
  assert.deepEqual(groups[0].rows.map(r => r.externalId), ['a::1', 'a::3']);
  assert.deepEqual(groupGlobalResultsByNamespace(null), []);
});

// ===================== Phase 1：A1 neighbors 上下文（方法存在性检测 + 降级） =====================

test('fetchNeighborsForHits 拉取邻居并解码楼层身份，异常静默降级', async () => {
  const client = {
    trivium: {
      neighbors: async ({ id, depth }) => {
        if (id === 1) {
          return { ids: [2, 3], nodes: [{ id: 2, externalId: 'c1::4', namespace: 'ns' }, { id: 3, externalId: 'bad', namespace: 'ns' }] };
        }
        throw new Error('boom');
      },
    },
  };
  const hits = [
    { externalId: 'c1::5', id: 1 },
    { externalId: 'c1::6', id: 2 },
    { externalId: 'c1::7' }, // 无内部 id：跳过
  ];
  const map = await fetchNeighborsForHits({ client, database: 'tl_vec_8', hits, topN: 5 });
  assert.deepEqual(map.get('c1::5'), [
    { externalId: 'c1::4', chatFile: 'c1', messageId: '4' },
    { externalId: 'bad', chatFile: 'bad', messageId: '' }, // 解码失败保留原始引用
  ]);
  assert.equal(map.has('c1::6'), false); // neighbors 抛错 → 无该键
  assert.equal(map.has('c1::7'), false);

  // 旧版宿主：方法不存在 → 空 Map
  const legacy = await fetchNeighborsForHits({ client: { trivium: {} }, database: 'd', hits });
  assert.equal(legacy.size, 0);
  // 库名缺失 → 空 Map
  const noDb = await fetchNeighborsForHits({ client, database: null, hits });
  assert.equal(noDb.size, 0);
});

test('expandHitWithContexts 关联邻居引用，缺省上下文为空数组', () => {
  const rows = [{ externalId: 'c1::5', score: 1 }, { externalId: 'c1::9', score: 0.5 }];
  const map = new Map([['c1::5', [{ chatFile: 'c1', messageId: '4' }]]]);
  const expanded = expandHitWithContexts(rows, map);
  assert.deepEqual(expanded[0].context, [{ chatFile: 'c1', messageId: '4' }]);
  assert.deepEqual(expanded[1].context, []);
  assert.deepEqual(expandHitWithContexts(null, map), []);
});
