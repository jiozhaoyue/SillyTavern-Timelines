/**
 * 多树视图纯函数模块单测（L1-MF-11：图算法纯函数 Node 100% 单测）。
 * 被测：src/multi-tree.js —— makeTreeId / assertTreeBudget / scopeTreeElements /
 *       boundingBoxOf / composeMultiTreePositions / buildMultiTreeElements
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTreeId,
  assertTreeBudget,
  scopeTreeElements,
  boundingBoxOf,
  composeMultiTreePositions,
  buildMultiTreeElements,
  resolveTreeCharacterIndex,
} from '../src/multi-tree.js';

/** 构造一棵模拟 buildGraph 输出的最小树：root + 2 消息节点（其中 1 个分叉）+ swipe 内层结构。 */
function sampleTree() {
  return [
    { group: 'nodes', data: { id: 'root', label: 'root', name: 'Alice' } },
    {
      group: 'nodes',
      data: {
        id: 'message1', msg: 'hello',
        file_name: 'chat1.jsonl',
        chat_sessions: { 'chat1.jsonl': { messageId: 0, indexInGroup: 0, length: 3 } },
        bookmarkName: null,
      },
    },
    {
      group: 'nodes',
      data: {
        id: 'message2', msg: 'world',
        file_name: 'chat2.jsonl',
        chat_sessions: { 'chat2.jsonl': { messageId: 1, indexInGroup: 0, length: 2 } },
        bookmarkName: 'folder/bookmark1',
        isBookmark: true,
        storedSwipes: [
          {
            node: { id: 'swipe2-1', msg: 'alt' },
            edge: { id: 'edgeSwipe2', source: 'message1', target: 'swipe2-1', isSwipe: true },
          },
        ],
      },
    },
    { group: 'edges', data: { id: 'edge1', source: 'root', target: 'message1' } },
    { group: 'edges', data: { id: 'edge2', source: 'message1', target: 'message2' } },
  ];
}

describe('makeTreeId', () => {
  test('角色优先于群组；两者皆缺省回退 char_unknown', () => {
    assert.equal(makeTreeId({ characterId: '3', groupId: '9' }), 'char_3');
    assert.equal(makeTreeId({ groupId: '9' }), 'group_9');
    assert.equal(makeTreeId({}), 'char_unknown');
    assert.equal(makeTreeId(), 'char_unknown');
  });
});

describe('assertTreeBudget', () => {
  test('desktop 上限 4：4 过、5 拒', () => {
    assert.equal(assertTreeBudget({ treeCount: 4, profile: 'desktop' }).ok, true);
    const over = assertTreeBudget({ treeCount: 5, profile: 'desktop' });
    assert.equal(over.ok, false);
    assert.equal(over.max, 4);
    assert.match(over.reason, /tree-limit-exceeded\(4\)/);
  });
  test('mobile（memorySaver 弱设备档）上限 2', () => {
    assert.equal(assertTreeBudget({ treeCount: 2, profile: 'mobile' }).ok, true);
    assert.equal(assertTreeBudget({ treeCount: 3, profile: 'mobile' }).ok, false);
  });
  test('非法数量拒绝；未知档位回落 desktop 上限', () => {
    assert.equal(assertTreeBudget({ treeCount: 0 }).ok, false);
    assert.equal(assertTreeBudget({ treeCount: 1.5 }).ok, false);
    assert.equal(assertTreeBudget({ treeCount: 5, profile: 'unknown' }).max, 4);
  });
});

describe('scopeTreeElements', () => {
  test('全部 id 引用加前缀并打 treeId：data.id / 边 source,target / storedSwipes 内层', () => {
    const scoped = scopeTreeElements(sampleTree(), 'char_0');
    const byId = Object.fromEntries(scoped.map(el => [el.data.id, el]));
    // data.id
    assert.ok(byId['char_0::root']);
    assert.ok(byId['char_0::message1']);
    // 边 source/target
    const edge = scoped.find(el => el.data.id === 'char_0::edge2');
    assert.equal(edge.data.source, 'char_0::message1');
    assert.equal(edge.data.target, 'char_0::message2');
    // storedSwipes 内层 node.id 与 edge.id/source/target
    const swipe = byId['char_0::message2'].data.storedSwipes[0];
    assert.equal(swipe.node.id, 'char_0::swipe2-1');
    assert.equal(swipe.edge.id, 'char_0::edgeSwipe2');
    assert.equal(swipe.edge.source, 'char_0::message1');
    assert.equal(swipe.edge.target, 'char_0::swipe2-1');
    // 每个元素都带 treeId
    assert.ok(scoped.every(el => el.data.treeId === 'char_0'));
    // group 字段保留
    assert.equal(scoped.filter(el => el.group === 'edges').length, 2);
  });

  test('导航数据字段不受污染：chat_sessions / file_name / bookmarkName 原样', () => {
    const scoped = scopeTreeElements(sampleTree(), 'group_7');
    const m1 = scoped.find(el => el.data.id === 'group_7::message1').data;
    assert.deepEqual(m1.chat_sessions, { 'chat1.jsonl': { messageId: 0, indexInGroup: 0, length: 3 } });
    assert.equal(m1.file_name, 'chat1.jsonl');
    const m2 = scoped.find(el => el.data.id === 'group_7::message2').data;
    assert.equal(m2.bookmarkName, 'folder/bookmark1');
    assert.equal(m2.isBookmark, true);
  });

  test('两棵树作用域化后 id 全域不相交（多树同屏前提）', () => {
    const a = scopeTreeElements(sampleTree(), 'char_0').map(el => el.data.id);
    const b = scopeTreeElements(sampleTree(), 'char_1').map(el => el.data.id);
    assert.equal(new Set([...a, ...b]).size, a.length + b.length);
  });

  test('拓扑保持不变量：节点/边数量与父子关系经前缀映射后 1:1 对应（关键节点保护前提）', () => {
    const src = sampleTree();
    const scoped = scopeTreeElements(src, 'char_0');
    const strip = id => String(id).replace(/^char_0::/, '');
    assert.equal(scoped.length, src.length);
    const srcEdges = src.filter(e => e.group === 'edges').map(e => [e.data.source, e.data.target]);
    const dstEdges = scoped.filter(e => e.group === 'edges').map(e => [strip(e.data.source), strip(e.data.target)]);
    assert.deepEqual(dstEdges, srcEdges);
    const srcIds = src.map(e => e.data.id).sort();
    const dstIds = scoped.map(e => strip(e.data.id)).sort();
    assert.deepEqual(dstIds, srcIds);
  });

  test('纯函数纪律：不修改入参', () => {
    const src = sampleTree();
    const snapshot = JSON.stringify(src);
    scopeTreeElements(src, 'char_0');
    assert.equal(JSON.stringify(src), snapshot);
  });

  test('空树Id 抛错；非数组输入容错为空数组', () => {
    assert.throws(() => scopeTreeElements(sampleTree(), ''), /treeId 不能为空/);
    assert.deepEqual(scopeTreeElements(null, 'char_0'), []);
  });
});

describe('composeMultiTreePositions', () => {
  const treeA = {
    treeId: 'char_0',
    positions: { 'char_0::root': { x: 0, y: 0 }, 'char_0::m1': { x: 100, y: 40 } },
  };
  const treeB = {
    treeId: 'char_1',
    positions: { 'char_1::root': { x: -50, y: -20 }, 'char_1::m1': { x: 60, y: 90 } },
  };

  test('确定性：同输入两次输出全等', () => {
    const r1 = composeMultiTreePositions([treeA, treeB], { columns: 2, gap: 120 });
    const r2 = composeMultiTreePositions([treeA, treeB], { columns: 2, gap: 120 });
    assert.deepEqual(r1, r2);
  });

  test('树内相对位移在平移后保持不变', () => {
    const { positions } = composeMultiTreePositions([treeA, treeB], { columns: 2, gap: 120 });
    const dxA = positions['char_0::m1'].x - positions['char_0::root'].x;
    const dyA = positions['char_0::m1'].y - positions['char_0::root'].y;
    assert.deepEqual([dxA, dyA], [100, 40]);
  });

  test('两棵树包围盒互不重叠（gap 间距生效）', () => {
    const { boxes, positions } = composeMultiTreePositions([treeA, treeB], { columns: 2, gap: 120 });
    assert.equal(boxes.length, 2);
    const [a, b] = boxes;
    const separatedHorizontally = a.maxX + 120 <= b.minX || b.maxX + 120 <= a.minX;
    const separatedVertically = a.maxY + 120 <= b.minY || b.maxY + 120 <= a.minY;
    assert.ok(separatedHorizontally || separatedVertically, `boxes=${JSON.stringify({ boxes, positions })}`);
  });

  test('多行网格：3 棵树 2 列时第三棵换行', () => {
    const treeC = { treeId: 'char_2', positions: { 'char_2::root': { x: 0, y: 0 } } };
    const { boxes } = composeMultiTreePositions([treeA, treeB, treeC], { columns: 2, gap: 50 });
    // 第三棵（row=1, col=0）的 minY 应大于第一棵（row=0, col=0）的 maxY + gap
    assert.ok(boxes[2].minY >= boxes[0].maxY + 50);
  });

  test('空布局与空输入容错', () => {
    const { positions, boxes } = composeMultiTreePositions([{ treeId: 'char_0', positions: null }]);
    assert.deepEqual(positions, {});
    assert.equal(boxes[0].empty, true);
    assert.deepEqual(composeMultiTreePositions([]), { positions: {}, boxes: [] });
  });
});

describe('buildMultiTreeElements', () => {
  test('拼接多树；重复 id 抛错（作用域化缺失的防线）', () => {
    const a = scopeTreeElements(sampleTree(), 'char_0');
    const b = scopeTreeElements(sampleTree(), 'char_1');
    const merged = buildMultiTreeElements([a, b]);
    assert.equal(merged.length, a.length + b.length);

    // 未作用域化的同一棵树出现两次 → id 冲突必须抛错
    assert.throws(() => buildMultiTreeElements([a, a]), /元素 id 冲突/);
  });

  test('空输入容错', () => {
    assert.deepEqual(buildMultiTreeElements([]), []);
    assert.deepEqual(buildMultiTreeElements(null), []);
  });
});

describe('resolveTreeCharacterIndex', () => {
  const trees = [
    { treeId: 'char_0', kind: 'char', refId: '0', avatar: 'avatar-a.png' },
    { treeId: 'char_1', kind: 'char', refId: '1', avatar: 'avatar-b.png' },
    { treeId: 'group_2', kind: 'group', refId: '2', avatar: null },
  ];
  const characters = [{ avatar: 'avatar-x.png' }, { avatar: 'avatar-b.png' }];

  test('数组重排后按 avatar 重定位到当前索引', () => {
    // 构建时 char_1 是索引 1，但数组重排后 avatar-b.png 落到索引 1（此处即 1）；换位场景：avatar-a 在索引 0 之外
    assert.equal(resolveTreeCharacterIndex(trees, 'char_1', characters), 1);
    assert.equal(resolveTreeCharacterIndex(trees, 'char_0', [{ avatar: 'avatar-b.png' }, { avatar: 'avatar-a.png' }]), 1);
  });

  test('avatar 缺失时回退构建时 refId 索引', () => {
    const noAvatar = [{ treeId: 'char_5', kind: 'char', refId: '5', avatar: null }];
    const list = [{ avatar: 'a' }, { avatar: 'b' }, { avatar: 'c' }, { avatar: 'd' }, { avatar: 'e' }, { avatar: 'f' }];
    assert.equal(resolveTreeCharacterIndex(noAvatar, 'char_5', list), 5);
  });

  test('群组树返回 null；越界索引返回 null；未知 treeId 返回 null', () => {
    assert.equal(resolveTreeCharacterIndex(trees, 'group_2', characters), null);
    assert.equal(resolveTreeCharacterIndex(trees, 'char_9', characters), null);
    assert.equal(resolveTreeCharacterIndex([], 'char_0', characters), null);
  });
});

describe('boundingBoxOf', () => {
  test('常规与空输入', () => {
    const box = boundingBoxOf({ a: { x: -10, y: 5 }, b: { x: 30, y: -2 } });
    assert.deepEqual({ minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY }, { minX: -10, minY: -2, maxX: 30, maxY: 5 });
    assert.equal(box.empty, false);
    assert.equal(boundingBoxOf({}).empty, true);
    assert.equal(boundingBoxOf(null).empty, true);
  });
});
