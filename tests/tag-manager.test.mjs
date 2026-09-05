import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNodeTags,
  hasNodeTagsOrBookmark,
  saveMessageTagsNative,
  DEFAULT_TAG_PALETTE,
} from '../src/tag-manager.js';

test('extractNodeTags parses tags from both direct property and message.extra', () => {
  const nodeDirect = {
    tags: ['主线', { name: '自定义', color: '#ff00ff' }],
  };
  const parsed1 = extractNodeTags(nodeDirect);
  assert.equal(parsed1.length, 2);
  assert.equal(parsed1[0].name, '主线');
  assert.equal(parsed1[0].color, DEFAULT_TAG_PALETTE[0].color);
  assert.equal(parsed1[1].name, '自定义');
  assert.equal(parsed1[1].color, '#ff00ff');

  const nodeExtra = {
    extra: {
      tags: ['战斗', '日常'],
    },
  };
  const parsed2 = extractNodeTags(nodeExtra);
  assert.equal(parsed2.length, 2);
  assert.equal(parsed2[0].name, '战斗');
  assert.equal(parsed2[1].name, '日常');
});

test('hasNodeTagsOrBookmark detects bookmarks and custom tags', () => {
  assert.equal(hasNodeTagsOrBookmark(null), false);
  assert.equal(hasNodeTagsOrBookmark({}), false);
  assert.equal(hasNodeTagsOrBookmark({ isBookmark: true }), true);
  assert.equal(hasNodeTagsOrBookmark({ bookmarkName: 'checkpoint-1' }), true);
  assert.equal(hasNodeTagsOrBookmark({ tags: ['主线'] }), true);
});

test('saveMessageTagsNative writes tags into message.extra and calls native saveChatDebounced', async () => {
  let saved = false;
  const mockContext = {
    characterId: 'char-1',
    chatId: 'chat-test-1',
    chat: [
      { mes: 'Hello', extra: {} },
      { mes: 'World' },
    ],
    saveChatDebounced: async () => {
      saved = true;
    },
  };

  const ok = await saveMessageTagsNative(1, [{ name: '关键决策', color: '#f59e0b' }], mockContext);
  assert.equal(ok, true);
  assert.equal(saved, true);
  assert.deepEqual(mockContext.chat[1].extra.tags, [
    { name: '关键决策', color: '#f59e0b' },
  ]);

  // 非法索引防护
  const invalid1 = await saveMessageTagsNative(-1, [], mockContext);
  assert.equal(invalid1, false);

  const invalid2 = await saveMessageTagsNative(999, [], mockContext);
  assert.equal(invalid2, false);

  const invalid3 = await saveMessageTagsNative('not-a-number', [], mockContext);
  assert.equal(invalid3, false);
});

test('extractNodeTags handles empty, null and deduplicates identical tag names', () => {
  assert.deepEqual(extractNodeTags(undefined), []);
  assert.deepEqual(extractNodeTags({}), []);
  assert.deepEqual(extractNodeTags({ tags: ['', '   '] }), []);

  const duplicateTags = {
    tags: [
      { name: '主线', color: '#f59e0b' },
      { name: '主线', color: '#ff0000' }, // 重复名称
      '战斗',
      { name: '战斗', color: '#10b981' }, // 重复名称
    ],
  };
  const result = extractNodeTags(duplicateTags);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, '主线');
  assert.equal(result[1].name, '战斗');
});
