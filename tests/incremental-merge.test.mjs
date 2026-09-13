import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffCytoscapeElements,
  applyElementPatch,
  assignProgressivePositions,
} from '../src/incremental-merge.js';

const nodeA = { group: 'nodes', data: { id: 'n1', msg: '第一条', chat_sessions: { 'a.jsonl': { messageId: 0 } } } };
const nodeB = { group: 'nodes', data: { id: 'n2', msg: '第二条', chat_sessions: { 'a.jsonl': { messageId: 1 } } } };
const edgeAB = { group: 'edges', data: { id: 'e1', source: 'n1', target: 'n2' } };

test('diffCytoscapeElements detects added/updated/removed by stable id', () => {
  // 空对非空：全部 added
  const initial = diffCytoscapeElements([], [nodeA, nodeB, edgeAB]);
  assert.equal(initial.added.length, 3);
  assert.equal(initial.updated.length, 0);
  assert.equal(initial.removed.length, 0);

  // chat_sessions 扩展（新分支共享前缀）→ updated；新节点/边 → added
  const nodeAExtended = {
    group: 'nodes',
    data: { id: 'n1', msg: '第一条', chat_sessions: { 'a.jsonl': { messageId: 0 }, 'b.jsonl': { messageId: 0 } } },
  };
  const nodeC = { group: 'nodes', data: { id: 'n3', msg: '新节点', chat_sessions: { 'b.jsonl': { messageId: 1 } } } };
  const edgeN1N3 = { group: 'edges', data: { id: 'e2', source: 'n1', target: 'n3' } };
  const second = diffCytoscapeElements([nodeA, nodeB, edgeAB], [nodeAExtended, nodeB, nodeC, edgeAB, edgeN1N3]);
  assert.deepEqual(second.added.map(e => e.data.id), ['n3', 'e2']);
  assert.deepEqual(second.updated.map(e => e.data.id), ['n1']);
  assert.equal(second.removed.length, 0);

  // 消失 → removed
  const third = diffCytoscapeElements([nodeA, nodeB], [nodeA]);
  assert.deepEqual(third.removed.map(e => e.data.id), ['n2']);

  // 键序不同但内容相同 → 不算更新
  const reordered = { group: 'nodes', data: { chat_sessions: { 'a.jsonl': { messageId: 0 } }, msg: '第一条', id: 'n1' } };
  assert.equal(diffCytoscapeElements([nodeA], [reordered]).updated.length, 0);
});

function makeMockCy() {
  const live = new Map();
  const calls = { removed: [], added: [], updated: [] };
  const cy = {
    batch(fn) {
      fn();
    },
    add(el) {
      calls.added.push(el.data.id);
      live.set(el.data.id, el);
    },
    getElementById(id) {
      const el = live.get(id);
      return {
        nonempty: () => Boolean(el),
        remove: () => {
          calls.removed.push(id);
          live.delete(id);
        },
        data: d => {
          calls.updated.push(id);
          live.set(id, { ...live.get(id), data: d });
        },
      };
    },
  };
  return { cy, calls, live };
}

test('applyElementPatch applies removals, additions and data updates in batch', () => {
  const { cy, calls } = makeMockCy();

  // 先加入 n1, n2, e1
  applyElementPatch(cy, { added: [nodeA, nodeB, edgeAB], updated: [], removed: [] });
  assert.deepEqual(calls.added, ['n1', 'n2', 'e1']);

  // n1 更新 + n2 删除 + n3 新增
  const nodeAUpdated = {
    group: 'nodes',
    data: { id: 'n1', msg: '第一条', chat_sessions: { 'a.jsonl': { messageId: 0 }, 'b.jsonl': { messageId: 0 } } },
  };
  applyElementPatch(cy, {
    added: [{ group: 'nodes', data: { id: 'n3', msg: 'x' } }],
    updated: [nodeAUpdated],
    removed: [nodeB],
  });
  assert.deepEqual(calls.updated, ['n1']);
  assert.deepEqual(calls.removed, ['n2']);
});

test('assignProgressivePositions anchors children below parents in a grid', () => {
  const existing = { root: { x: 0, y: 0 }, p1: { x: 100, y: 200 } };
  const getPosition = id => existing[id] ?? null;

  const added = [
    { group: 'nodes', data: { id: 'c1' } },
    { group: 'nodes', data: { id: 'c2' } },
    { group: 'nodes', data: { id: 'c3' } },
    { group: 'nodes', data: { id: 'c4' } },
    { group: 'nodes', data: { id: 'c5' } }, // 第二行
    { group: 'edges', data: { id: 'e', source: 'p1', target: 'c1' } },
    { group: 'edges', data: { id: 'e2', source: 'p1', target: 'c2' } },
    { group: 'nodes', data: { id: 'orphan' } }, // 无父节点 → 锚定 root
  ];

  const positions = assignProgressivePositions(added, getPosition, { dx: 90, dy: 140 });

  // c1/c2 父节点是 p1（通过新增边推导），同父子节点横向铺开
  assert.deepEqual(positions.get('c1'), { x: 100, y: 340 });
  assert.deepEqual(positions.get('c2'), { x: 190, y: 340 });
  // c3/c4/c5/orphan 无父可依 → 依序锚定 root 网格
  assert.deepEqual(positions.get('c3'), { x: 0, y: 140 });
  assert.deepEqual(positions.get('c4'), { x: 90, y: 140 });
  assert.deepEqual(positions.get('c5'), { x: 180, y: 140 });
  assert.deepEqual(positions.get('orphan'), { x: 270, y: 140 });
  // 边不参与定位
  assert.equal(positions.size, 6);

  // 根节点本身不可定位
  const withRoot = assignProgressivePositions(
    [{ group: 'nodes', data: { id: 'root' } }],
    () => null,
  );
  assert.equal(withRoot.size, 0);
});
