import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneNativeMessage,
  cherryPickMessageToCurrentChat,
  synthesizeMergedChatSequence,
  generateMergeBranchName,
} from '../src/merge-service.js';

test('cloneNativeMessage faithfully clones message and insulates extra', () => {
  const orig = {
    name: '莉莉娅',
    is_user: false,
    is_system: false,
    send_date: 1725500000000,
    mes: '你好！今天想去哪里探险呢？',
    extra: {
      tags: [{ name: '主线', color: '#f59e0b' }],
      memory_key: 'castle_start',
    },
    swipes: ['你好！', '今天想去哪里探险呢？'],
    swipe_id: 1,
  };

  const cloned = cloneNativeMessage(orig);
  assert.equal(cloned.name, '莉莉娅');
  assert.equal(cloned.is_user, false);
  assert.equal(cloned.mes, '你好！今天想去哪里探险呢？');
  assert.equal(cloned.swipe_id, 1);
  assert.equal(cloned.swipes.length, 2);

  // 验证 extra 深度隔离
  cloned.extra.tags.push({ name: '修改', color: '#ff0000' });
  assert.equal(orig.extra.tags.length, 1);
  assert.equal(cloned.extra.tags.length, 2);
});

test('cloneNativeMessage handles invalid or null inputs safely', () => {
  assert.equal(cloneNativeMessage(null), null);
  assert.equal(cloneNativeMessage(undefined), null);
  assert.equal(cloneNativeMessage('invalid'), null);
});

test('cherryPickMessageToCurrentChat appends message and preserves line 0 metadata', async () => {
  let saved = false;
  const mockContext = {
    chat: [
      { user_name: 'Player', character_name: 'Hero' }, // line 0: metadata
      { name: 'Player', is_user: true, mes: '出发！' },  // line 1
    ],
  };

  const sourceMsg = {
    name: 'Hero',
    is_user: false,
    mes: '我们向北方的密林进发。',
    extra: { tags: [{ name: '探险', color: '#10b981' }] },
  };

  const result = await cherryPickMessageToCurrentChat(sourceMsg, mockContext, {
    saveFn: async () => { saved = true; },
  });

  assert.equal(result.success, true);
  assert.equal(mockContext.chat.length, 3);
  assert.equal(mockContext.chat[2].name, 'Hero');
  assert.equal(mockContext.chat[2].mes, '我们向北方的密林进发。');
  assert.equal(saved, true);
  // 确认 line 0 未受破坏
  assert.equal(mockContext.chat[0].user_name, 'Player');
});

test('cherryPickMessageToCurrentChat supports targetIndex insertion >= 1', async () => {
  const mockContext = {
    chat: [
      { user_name: 'Player' }, // 0
      { mes: 'A' },            // 1
      { mes: 'B' },            // 2
    ],
  };

  const sourceMsg = { mes: 'INSERTED' };
  const res = await cherryPickMessageToCurrentChat(sourceMsg, mockContext, { targetIndex: 1 });

  assert.equal(res.success, true);
  assert.equal(res.index, 1);
  assert.equal(mockContext.chat.length, 4);
  assert.equal(mockContext.chat[1].mes, 'INSERTED');
  assert.equal(mockContext.chat[2].mes, 'A');
});

test('synthesizeMergedChatSequence correctly handles different merge strategies', () => {
  const prefix = [{ mes: 'Root' }, { mes: 'LCA' }];
  const diffA = [{ mes: 'A1' }, { mes: 'A2' }];
  const diffB = [{ mes: 'B1' }, { mes: 'B2' }, { mes: 'B3' }];

  // 1. APPEND_B_TO_A (默认: 前缀 -> A 差异 -> B 差异)
  const merged1 = synthesizeMergedChatSequence(prefix, diffA, diffB, 'APPEND_B_TO_A');
  assert.deepEqual(merged1.map(m => m.mes), ['Root', 'LCA', 'A1', 'A2', 'B1', 'B2', 'B3']);

  // 2. APPEND_A_TO_B (前缀 -> B 差异 -> A 差异)
  const merged2 = synthesizeMergedChatSequence(prefix, diffA, diffB, 'APPEND_A_TO_B');
  assert.deepEqual(merged2.map(m => m.mes), ['Root', 'LCA', 'B1', 'B2', 'B3', 'A1', 'A2']);

  // 3. INTERLEAVED (前缀 -> A1, B1, A2, B2, B3)
  const merged3 = synthesizeMergedChatSequence(prefix, diffA, diffB, 'INTERLEAVED');
  assert.deepEqual(merged3.map(m => m.mes), ['Root', 'LCA', 'A1', 'B1', 'A2', 'B2', 'B3']);
});

test('generateMergeBranchName produces sanitized unique branch identifiers', () => {
  const name = generateMergeBranchName('Chat_Forest.jsonl', 'Chat_Cave.jsonl', new Date('2026-09-05T12:30:45Z'));
  assert.ok(name.startsWith('Merge_Chat_Forest_Chat_Cave_'));
  assert.ok(!name.includes('.jsonl'));
});
