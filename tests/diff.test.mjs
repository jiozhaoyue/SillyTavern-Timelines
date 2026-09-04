import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeNode, computeBranchLCA, extractPathToRoot } from '../src/diff-service.js';

test('summarizeNode correctly extracts data from Cytoscape node object', () => {
    const mockCyNode = {
        data: () => ({
            id: 'msg_001',
            name: 'Izumi',
            msg: 'Hello world',
            is_user: false,
            swipeId: 1,
            storedSwipes: [{ node: { id: 'swipe_1' } }],
            chat_sessions: {
                'chat_2026.jsonl': { messageId: 4, swipeId: 1 },
            },
        }),
    };

    const summary = summarizeNode(mockCyNode);
    assert.equal(summary.id, 'msg_001');
    assert.equal(summary.name, 'Izumi');
    assert.equal(summary.msg, 'Hello world');
    assert.equal(summary.isUser, false);
    assert.equal(summary.swipeId, 1);
    assert.equal(summary.totalSwipes, 2);
    assert.equal(summary.chatFile, 'chat_2026.jsonl');
    assert.equal(summary.messageId, 4);
});

test('computeBranchLCA detects diverging branches and extracts diffs', () => {
    const root = { id: 'root', name: 'System', msg: 'Init' };
    const n1 = { id: 'n1', name: 'User', msg: 'Hi' };
    const n2 = { id: 'n2', name: 'Bot', msg: 'Greetings' };

    const a1 = { id: 'a1', name: 'User', msg: 'Let us go to the beach' };
    const a2 = { id: 'a2', name: 'Bot', msg: 'Sounds sunny!' };

    const b1 = { id: 'b1', name: 'User', msg: 'Let us go to the mountains' };

    const pathA = [root, n1, n2, a1, a2];
    const pathB = [root, n1, n2, b1];

    const result = computeBranchLCA(pathA, pathB);
    assert.ok(result.lcaNode);
    assert.equal(result.lcaNode.id, 'n2');
    assert.equal(result.commonDepth, 2);

    assert.equal(result.diffA.length, 2);
    assert.equal(result.diffA[0].id, 'a1');
    assert.equal(result.diffA[1].id, 'a2');

    assert.equal(result.diffB.length, 1);
    assert.equal(result.diffB[0].id, 'b1');

    assert.equal(result.stats.depthA, 5);
    assert.equal(result.stats.depthB, 4);
    assert.equal(result.stats.diffACount, 2);
    assert.equal(result.stats.diffBCount, 1);
});

test('computeBranchLCA handles prefix branch relationship', () => {
    const root = { id: 'root' };
    const n1 = { id: 'n1' };
    const n2 = { id: 'n2' };

    const pathLong = [root, n1, n2];
    const pathShort = [root, n1];

    const res = computeBranchLCA(pathLong, pathShort);
    assert.equal(res.lcaNode.id, 'n1');
    assert.equal(res.commonDepth, 1);
    assert.equal(res.diffA.length, 1);
    assert.equal(res.diffA[0].id, 'n2');
    assert.equal(res.diffB.length, 0);
});

test('computeBranchLCA handles completely disjoint paths and empty inputs', () => {
    const resDisjoint = computeBranchLCA([{ id: 'x' }], [{ id: 'y' }]);
    assert.equal(resDisjoint.lcaNode, null);
    assert.equal(resDisjoint.commonDepth, -1);
    assert.equal(resDisjoint.diffA.length, 1);
    assert.equal(resDisjoint.diffB.length, 1);

    const resEmpty = computeBranchLCA([], []);
    assert.equal(resEmpty.lcaNode, null);
    assert.equal(resEmpty.commonDepth, -1);
    assert.equal(resEmpty.diffA.length, 0);
    assert.equal(resEmpty.diffB.length, 0);
});

test('extractPathToRoot correctly walks incoming edges to root', () => {
    // Mock a linked chain: root -> n1 -> n2
    const rootNode = {
        id: () => 'root',
        data: () => ({ id: 'root', msg: 'root message' }),
        incomers: () => [],
    };
    const n1Node = {
        id: () => 'n1',
        data: () => ({ id: 'n1', msg: 'n1 message' }),
        incomers: () => [{ source: () => rootNode }],
    };
    const n2Node = {
        id: () => 'n2',
        data: () => ({ id: 'n2', msg: 'n2 message' }),
        incomers: () => [{ source: () => n1Node }],
    };

    const path = extractPathToRoot(n2Node);
    assert.equal(path.length, 3);
    assert.equal(path[0].id, 'root');
    assert.equal(path[1].id, 'n1');
    assert.equal(path[2].id, 'n2');
});
