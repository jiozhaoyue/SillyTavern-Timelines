import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearchQuery,
  matchesNode,
  filterGraphNodes,
} from '../src/search-service.js';

test('parseSearchQuery parses plain text and regex expressions correctly', () => {
  assert.deepEqual(parseSearchQuery(''), { isRegex: false, fragments: [] });
  assert.deepEqual(parseSearchQuery('   '), { isRegex: false, fragments: [] });

  const plain = parseSearchQuery('Tavern Master');
  assert.equal(plain.isRegex, false);
  assert.deepEqual(plain.fragments, ['tavern', 'master']);

  const regex = parseSearchQuery('/dragon|wyrm/i');
  assert.equal(regex.isRegex, true);
  assert.ok(regex.regex instanceof RegExp);
  assert.ok(regex.regex.test('Here comes a red dragon!'));
  assert.ok(!regex.regex.test('Just a goblin'));

  // Invalid regex syntax gracefully falls back to plain fragments
  const invalidRegex = parseSearchQuery('/[invalid(/i');
  assert.equal(invalidRegex.isRegex, false);
  assert.ok(invalidRegex.fragments.length > 0);
});

test('matchesNode filters by speaker, bookmark, tags, swipes and floor range', () => {
  const node = {
    message: 'I cast a fireball at the goblin army.',
    is_user: true,
    depth: 7,
    bookmark: true,
    tags: ['combat', 'magic'],
    swipes: ['swipe 1', 'swipe 2'],
  };

  // 1. Match all by default
  assert.ok(matchesNode(node, {}));

  // 2. Speaker match
  assert.ok(matchesNode(node, { speakerFilter: 'user' }));
  assert.ok(!matchesNode(node, { speakerFilter: 'character' }));

  // 3. Bookmarks
  assert.ok(matchesNode(node, { onlyBookmarks: true }));
  assert.ok(!matchesNode({ ...node, bookmark: false }, { onlyBookmarks: true }));

  // 4. Tags
  assert.ok(matchesNode(node, { onlyTagged: true }));
  assert.ok(matchesNode(node, { selectedTag: 'combat' }));
  assert.ok(!matchesNode(node, { selectedTag: 'romance' }));

  // 5. Swipes (> 1)
  assert.ok(matchesNode(node, { onlySwipes: true }));
  assert.ok(!matchesNode({ ...node, swipes: ['only one'] }, { onlySwipes: true }));

  // 6. Floor range
  assert.ok(matchesNode(node, { minFloor: 5, maxFloor: 10 }));
  assert.ok(!matchesNode(node, { minFloor: 8, maxFloor: 10 }));
  assert.ok(!matchesNode(node, { minFloor: 1, maxFloor: 6 }));
});

test('matchesNode filters text with keywords AND logic and regex', () => {
  const node = {
    message: 'The ancient dragon guards the golden chest.',
    name: 'Narrator',
    depth: 12,
  };

  // AND keywords
  assert.ok(matchesNode(node, { query: 'ancient dragon' }));
  assert.ok(!matchesNode(node, { query: 'ancient silver' }));

  // Regex
  assert.ok(matchesNode(node, { query: '/guard(s|ed)/i' }));
  assert.ok(!matchesNode(node, { query: '/goblin/i' }));
});

test('filterGraphNodes filters collection and ignores cluster nodes', () => {
  const nodes = [
    { data: { id: 'n1', message: 'Hello world', is_user: false, floor: 0 } },
    { data: { id: 'n2', message: 'Hello user', is_user: true, floor: 1 } },
    { data: { id: 'n3', isCluster: true, message: 'Collapsed cluster hello' } },
  ];

  const userMatches = filterGraphNodes(nodes, { speakerFilter: 'user', query: 'hello' });
  assert.equal(userMatches.length, 1);
  assert.equal(userMatches[0].data.id, 'n2');

  const allHello = filterGraphNodes(nodes, { query: 'hello' });
  // n3 is a cluster node, should be ignored
  assert.equal(allHello.length, 2);
});

test('matchesNode matches message text from real graph node data (msg field)', () => {
  // 真实图谱节点（graph-builder createNode）的文本字段是 `msg`，而非 message/text
  const node = {
    id: 'message7',
    msg: 'The ancient dragon guards the golden chest.',
    name: 'Narrator',
    is_user: false,
    depth: 12,
    chat_sessions: { 'chat-a.jsonl': { messageId: 12, indexInGroup: 12, length: 30 } },
  };

  // AND keywords via msg
  assert.ok(matchesNode(node, { query: 'ancient dragon' }));
  assert.ok(!matchesNode(node, { query: 'ancient silver' }));
  // Regex via msg
  assert.ok(matchesNode(node, { query: '/guard(s|ed)/i' }));
  assert.ok(!matchesNode(node, { query: '/goblin/i' }));

  const nodes = [{ data: node }];
  assert.equal(filterGraphNodes(nodes, { query: 'dragon' }).length, 1);
  assert.equal(filterGraphNodes(nodes, { query: 'wyvern' }).length, 0);
});

test('matchesNode swipe and floor filters work on real graph node shape', () => {
  // 真实图谱节点：父节点带 totalSwipes / chat_depth，swipe 变体节点带 isSwipe/swipeId
  const parentWithSwipes = { id: 'm1', msg: '有重试的节点', totalSwipes: 3, chat_depth: 8 };
  const parentWithoutSwipes = { id: 'm2', msg: '没有重试的节点', totalSwipes: 0, chat_depth: 9 };
  const swipeNode = { id: 'swipe1', msg: 'swipe 变体', isSwipe: true, swipeId: 1, chat_depth: 8 };
  const plainNode = { id: 'm3', msg: '普通节点', chat_depth: 2 };

  // 仅含分支重试：totalSwipes > 1 的父节点与 swipe 变体节点命中
  assert.ok(matchesNode(parentWithSwipes, { onlySwipes: true }));
  assert.ok(matchesNode(swipeNode, { onlySwipes: true }));
  assert.ok(!matchesNode(parentWithoutSwipes, { onlySwipes: true }));
  assert.ok(!matchesNode(plainNode, { onlySwipes: true }));

  // 楼层切片：chat_depth 参与范围比较
  assert.ok(matchesNode(parentWithSwipes, { minFloor: 5, maxFloor: 10 }));
  assert.ok(!matchesNode(parentWithSwipes, { minFloor: 9 }));
  assert.ok(matchesNode(plainNode, { maxFloor: 5 }));
  assert.ok(!matchesNode(plainNode, { minFloor: 5 }));

  // 组合：重试 + 楼层
  assert.ok(matchesNode(parentWithSwipes, { onlySwipes: true, minFloor: 5 }));
  assert.ok(!matchesNode(parentWithSwipes, { onlySwipes: true, minFloor: 20 }));
});

test('filterGraphNodes keeps legacy message/swipes/swipe_id shapes working', () => {
  const legacy = { data: { id: 'x', message: 'legacy text hello', swipes: ['a', 'b', 'c'], depth: 4 } };
  assert.ok(matchesNode(legacy.data, { query: 'hello' }));
  assert.ok(matchesNode(legacy.data, { onlySwipes: true }));
  assert.ok(matchesNode(legacy.data, { minFloor: 3, maxFloor: 6 }));
  assert.ok(!matchesNode(legacy.data, { maxFloor: 2 }));
});
