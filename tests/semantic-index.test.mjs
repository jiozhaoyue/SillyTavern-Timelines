import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeExternalId,
  decodeExternalId,
  buildNodePayload,
  computeContentHash,
  enumerateIndexEntries,
  diffIndexState,
  buildFloorLinks,
} from '../src/semantic-index-service.js';

test('encode/decode externalId roundtrip with .jsonl normalization', () => {
  assert.equal(encodeExternalId('chat-20240101-1200.jsonl', 5), 'chat-20240101-1200::5');
  assert.equal(encodeExternalId('session-a', 0), 'session-a::0');

  const decoded = decodeExternalId('session-a::12');
  assert.deepEqual(decoded, { chatFile: 'session-a', messageId: '12' });

  // 会话名本身包含分隔符时按最后一个 :: 拆分
  const tricky = decodeExternalId('weird::name::3');
  assert.deepEqual(tricky, { chatFile: 'weird::name', messageId: '3' });

  assert.equal(decodeExternalId('no-separator'), null);
  assert.equal(decodeExternalId('::'), null);
  assert.equal(decodeExternalId(''), null);
  assert.equal(decodeExternalId(null), null);

  const roundtrip = decodeExternalId(encodeExternalId('s.jsonl', 42));
  assert.deepEqual(roundtrip, { chatFile: 's', messageId: '42' });
});

test('buildNodePayload maps node data with preview truncation and tags', () => {
  const longText = '龙'.repeat(300);
  const payload = buildNodePayload(
    {
      message: longText,
      name: '艾莉亚',
      is_user: false,
      depth: 7,
      extra: { bookmark: true },
      tags: [{ name: '主线' }],
    },
    'branch-a.jsonl',
    9,
  );

  assert.equal(payload.chatFile, 'branch-a');
  assert.equal(payload.messageId, 9);
  assert.equal(payload.name, '艾莉亚');
  assert.equal(payload.is_user, false);
  assert.equal(payload.depth, 7);
  assert.equal(payload.bookmark, true);
  assert.deepEqual(payload.tags, ['主线']);
  assert.equal(payload.preview.length, 200 + 3); // 200 字符 + 省略号
  assert.ok(payload.preview.endsWith('...'));

  // 空数据健壮性
  const empty = buildNodePayload({}, 'x', 1);
  assert.equal(empty.name, '');
  assert.equal(empty.bookmark, false);
  assert.deepEqual(empty.tags, []);
  assert.equal(empty.preview, '');
});

test('computeContentHash is stable and sensitive to text/meta changes', () => {
  const node = { message: '你好', name: 'A', is_user: true };
  const h1 = computeContentHash(node, 'c.jsonl', 1);
  assert.equal(h1, computeContentHash({ ...node }, 'c', 1));
  assert.notEqual(h1, computeContentHash({ ...node, message: '再见' }, 'c', 1));
  assert.notEqual(h1, computeContentHash({ ...node }, 'c', 2));
  assert.notEqual(h1, computeContentHash({ ...node, extra: { bookmark: true } }, 'c', 1));
});

test('enumerateIndexEntries walks chat_sessions and skips edges/clusters', () => {
  const elements = [
    { data: { id: 'root', root: true } },
    {
      data: {
        id: 'n1',
        message: '第一条',
        name: 'User',
        is_user: true,
        depth: 0,
        chat_sessions: { 'a.jsonl': { messageId: 0 }, 'b.jsonl': { messageId: 0 } },
      },
    },
    { data: { source: 'n1', target: 'n2' } }, // 边，跳过
    { data: { id: 'c1', isLodCluster: true, chat_sessions: { 'z.jsonl': { messageId: 1 } } } }, // 聚合节点，跳过
    {
      data: {
        id: 'n2',
        message: '第二条',
        name: 'AI',
        is_user: false,
        depth: 1,
        chat_sessions: { 'a.jsonl': { messageId: 1 } },
      },
    },
  ];

  const entries = enumerateIndexEntries(elements);
  assert.equal(entries.length, 3); // a::0, a::1, b::0
  const ids = entries.map(e => e.externalId);
  assert.ok(ids.includes('a::0'));
  assert.ok(ids.includes('a::1'));
  assert.ok(ids.includes('b::0'));

  // 排序稳定且枚举幂等
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(enumerateIndexEntries(entries.map(e => e.nodeData)).length, 3);
  assert.deepEqual(enumerateIndexEntries(null), []);
});

function makeEntry(chatFile, messageId, text) {
  return {
    chatFile,
    messageId,
    externalId: encodeExternalId(chatFile, messageId),
    nodeData: { message: text, name: 'A', is_user: false },
  };
}

test('diffIndexState detects inserted/changed/deleted/unchanged with db isolation', () => {
  const entries = [
    makeEntry('a', 0, '旧文本'), // 内容未变
    makeEntry('a', 1, '新文本'), // 状态表中哈希不同 -> 变更
    makeEntry('a', 2, '全新文本'), // 状态表中不存在 -> 新增
  ];
  const nodeDataA0 = { message: '旧文本', name: 'A', is_user: false };
  const stateRows = [
    { chat_file: 'a', message_id: 0, content_hash: computeContentHash(nodeDataA0, 'a', 0), trivium_db: 'tl_vec_1536' },
    { chat_file: 'a', message_id: 1, content_hash: 'outdated-hash', trivium_db: 'tl_vec_1536' },
    { chat_file: 'a', message_id: 9, content_hash: 'gone-hash', trivium_db: 'tl_vec_1536' }, // 已消失
    { chat_file: 'b', message_id: 3, content_hash: 'other-db-hash', trivium_db: 'tl_vec_384' }, // 其他库
  ];

  const diff = diffIndexState(entries, stateRows, 'tl_vec_1536');

  assert.equal(diff.unchangedCount, 1);
  assert.deepEqual(
    diff.upserts.map(e => e.externalId),
    ['a::1', 'a::2'],
  );
  assert.deepEqual(diff.deletes, ['a::9']); // 消失且属于当前库
  assert.deepEqual(diff.staleOtherDb, ['b::3']); // 其他库不动，只上报

  // 全部条目都属于其他库时：视为待写新库，旧行进入 staleOtherDb
  const diff2 = diffIndexState(entries, stateRows, 'tl_vec_384');
  assert.equal(diff2.upserts.length, 3);
  assert.ok(diff2.staleOtherDb.includes('a::0'));
  assert.ok(diff2.staleOtherDb.includes('a::1'));
  assert.deepEqual(diff2.deletes, ['b::3']); // b::3 在 384 库上属于当前库，且条目已消失

  // 空输入
  assert.deepEqual(diffIndexState([], [], 'tl_vec_1536'), { upserts: [], deletes: [], staleOtherDb: [], unchangedCount: 0 });
});

test('buildFloorLinks chains consecutive floors within the same chat only', () => {
  const entries = [
    makeEntry('a', 2, '第三楼'),
    makeEntry('a', 0, '第一楼'),
    makeEntry('a', 1, '第二楼'),
    makeEntry('b', 0, '另一会话'),
    makeEntry('b', 1, '另一会话二楼'),
  ];

  const links = buildFloorLinks(entries);
  assert.equal(links.length, 3); // a: 0->1, 1->2; b: 0->1
  assert.deepEqual(links[0], {
    src: { externalId: 'a::0' },
    dst: { externalId: 'a::1' },
    label: 'next',
    weight: 1,
  });
  assert.deepEqual(links[1].src, { externalId: 'a::1' });
  assert.deepEqual(links[1].dst, { externalId: 'a::2' });
  assert.deepEqual(links[2], {
    src: { externalId: 'b::0' },
    dst: { externalId: 'b::1' },
    label: 'next',
    weight: 1,
  });

  // 相邻链接严格按楼层递增
  assert.ok(links.every(l => Number(l.src.externalId.split('::')[1]) < Number(l.dst.externalId.split('::')[1])));
  assert.deepEqual(buildFloorLinks([]), []);
  assert.deepEqual(buildFloorLinks(null), []);
});
