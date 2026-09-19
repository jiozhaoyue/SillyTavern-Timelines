import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFullTextFromCache } from '../src/node-text.js';

const SESSIONS = {
  'chat-A.jsonl': { messageId: 2, indexInGroup: 2, length: 10 },
};

function truncatedNode(overrides = {}) {
  return {
    msg: '这是一段被截断的预览...',
    msgTruncated: true,
    chat_sessions: SESSIONS,
    ...overrides,
  };
}

const MESSAGES = [
  { mes: '第 0 层' },
  { mes: '第 1 层', swipes: ['第 1 层', '变体 B', '变体 C'] },
  { mes: '第 2 层完整全文', swipes: ['第 2 层完整全文', '第 2 层的 swipe 变体'] },
];

test('未截断节点返回 null（调用方直接使用 msg 预览）', () => {
  const node = { ...truncatedNode(), msgTruncated: false };
  assert.equal(resolveFullTextFromCache(node, MESSAGES), null);
});

test('普通截断节点解析楼层 mes 全文', () => {
  assert.equal(resolveFullTextFromCache(truncatedNode(), MESSAGES), '第 2 层完整全文');
});

test('swipe 节点解析对应 swipes 变体文本', () => {
  const node = truncatedNode({ isSwipe: true, swipeId: 1 });
  assert.equal(resolveFullTextFromCache(node, MESSAGES), '第 2 层的 swipe 变体');
});

test('swipe 变体缺失或索引越界时返回 null', () => {
  const outOfRange = truncatedNode({ isSwipe: true, swipeId: 99 });
  assert.equal(resolveFullTextFromCache(outOfRange, MESSAGES), null);

  const noSwipes = truncatedNode({ isSwipe: true, swipeId: 0 });
  assert.equal(resolveFullTextFromCache(noSwipes, [MESSAGES[2]]), null);
});

test('indexInGroup 缺失时回退 messageId 定位楼层', () => {
  const node = truncatedNode({ chat_sessions: { 'chat-A.jsonl': { messageId: 1 } } });
  assert.equal(resolveFullTextFromCache(node, MESSAGES), '第 1 层');
});

test('缓存缺失 / 消息数组为空 / 楼层索引越界均返回 null', () => {
  assert.equal(resolveFullTextFromCache(truncatedNode(), null), null);
  assert.equal(resolveFullTextFromCache(truncatedNode(), []), null);
  const outOfRange = truncatedNode({ chat_sessions: { 'chat-A.jsonl': { messageId: 99 } } });
  assert.equal(resolveFullTextFromCache(outOfRange, MESSAGES), null);
});

test('chat_sessions 为空或楼层文本为空时返回 null', () => {
  assert.equal(resolveFullTextFromCache(truncatedNode({ chat_sessions: {} }), MESSAGES), null);
  assert.equal(resolveFullTextFromCache(truncatedNode({ chat_sessions: { 'chat-A.jsonl': { messageId: 0 } } }), [{ mes: '' }]), null);
});

test('非法入参不抛异常', () => {
  assert.equal(resolveFullTextFromCache(null, MESSAGES), null);
  assert.equal(resolveFullTextFromCache(truncatedNode(), 'not-an-array'), null);
});
