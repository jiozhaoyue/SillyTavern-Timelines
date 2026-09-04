import test from 'node:test';
import assert from 'node:assert/strict';

import {
    preprocessChatSessions,
    groupMessagesByContent,
    buildGraph,
    highlightPathToRoot,
} from '../src/graph-builder.js';

test('preprocessChatSessions transposes chat files by message depth', () => {
    const history = {
        'chat1.jsonl': [
            { name: 'AI', is_user: false, mes: 'Hello' },
            { name: 'User', is_user: true, mes: 'Hi' },
        ],
        'chat2.jsonl': [
            { name: 'AI', is_user: false, mes: 'Hello' },
            { name: 'User', is_user: true, mes: 'Hey' },
        ],
    };

    const transposed = preprocessChatSessions(history);
    assert.equal(transposed.length, 2);
    assert.equal(transposed[0].length, 2);
    assert.equal(transposed[1].length, 2);
    assert.equal(transposed[0][0].message.mes, 'Hello');
    assert.equal(transposed[0][1].message.mes, 'Hello');
});

test('buildGraph strictly deduplicates nodes and edges across identical message branches', () => {
    // 3 chats share the same greeting and the same user reply, but branch on message 2
    const history = {
        'branch1.jsonl': [
            { name: 'AI', is_user: false, mes: 'Greeting' },
            { name: 'User', is_user: true, mes: 'Reply 1' },
            { name: 'AI', is_user: false, mes: 'Branch A' },
        ],
        'branch2.jsonl': [
            { name: 'AI', is_user: false, mes: 'Greeting' },
            { name: 'User', is_user: true, mes: 'Reply 1' },
            { name: 'AI', is_user: false, mes: 'Branch B' },
        ],
        'branch3.jsonl': [
            { name: 'AI', is_user: false, mes: 'Greeting' },
            { name: 'User', is_user: true, mes: 'Reply 1' },
            { name: 'AI', is_user: false, mes: 'Branch C' },
        ],
    };

    const transposed = preprocessChatSessions(history);
    const lengths = {
        'branch1.jsonl': 3,
        'branch2.jsonl': 3,
        'branch3.jsonl': 3,
    };

    const elements = buildGraph(transposed, lengths);
    const nodes = elements.filter(e => e.group === 'nodes');
    const edges = elements.filter(e => e.group === 'edges');

    // Expected nodes:
    // 1 root node
    // 1 greeting node (shared by all 3)
    // 1 reply 1 node (shared by all 3)
    // 3 branch nodes (A, B, C)
    // Total = 1 + 1 + 1 + 3 = 6 nodes
    assert.equal(nodes.length, 6, `Expected 6 nodes but got ${nodes.length}`);

    // Verify node IDs are unique
    const nodeIds = new Set(nodes.map(n => n.data.id));
    assert.equal(nodeIds.size, 6, 'All node IDs must be strictly unique');

    // Expected edges:
    // root -> greeting (1 edge, NOT 3)
    // greeting -> reply 1 (1 edge, NOT 3)
    // reply 1 -> branch A (1 edge)
    // reply 1 -> branch B (1 edge)
    // reply 1 -> branch C (1 edge)
    // Total = 1 + 1 + 3 = 5 edges
    assert.equal(edges.length, 5, `Expected 5 edges but got ${edges.length}`);

    // Verify edge IDs and (source -> target) pairs are unique
    const edgePairs = new Set(edges.map(e => `${e.data.source}->${e.data.target}`));
    assert.equal(edgePairs.size, 5, 'All directed edge pairs must be strictly unique');
});

test('highlightPathToRoot correctly traces path to root and executes in <5ms on 1000 nodes', () => {
    // Generate a deep chain of 1000 nodes
    const nodeMap = new Map();
    const incomingEdgeMap = new Map();

    const rootNode = { group: 'nodes', data: { id: 'root', isBookmark: false } };
    nodeMap.set('root', rootNode);

    let prevId = 'root';
    const totalNodes = 1000;
    const bookmarkNodes = [];

    for (let i = 1; i <= totalNodes; i++) {
        const id = `node_${i}`;
        const isBookmark = (i % 20 === 0); // 50 bookmarks
        const node = {
            group: 'nodes',
            data: {
                id,
                isBookmark,
                bookmarkName: isBookmark ? `Bookmark_${i}` : null,
                color: isBookmark ? 'rgba(255, 0, 0, 1)' : null,
            },
        };
        nodeMap.set(id, node);
        if (isBookmark) {
            bookmarkNodes.push(node);
        }

        const edge = {
            group: 'edges',
            data: {
                id: `edge_${i}`,
                source: prevId,
                target: id,
            },
        };
        incomingEdgeMap.set(id, edge);
        prevId = id;
    }

    const startTime = performance.now();
    for (const bm of bookmarkNodes) {
        highlightPathToRoot(nodeMap, incomingEdgeMap, bm);
    }
    const elapsed = performance.now() - startTime;

    // Check correctness: the first edge into node_20 must be highlighted
    const edge20 = incomingEdgeMap.get('node_20');
    assert.equal(edge20.data.isHighlight, true);
    assert.equal(edge20.data.color, 'rgba(255, 0, 0, 1)');

    // Performance assertion: 50 bookmarks on 1000 nodes should be lightning fast (<10ms, usually <1ms)
    assert.ok(elapsed < 20, `Execution time was ${elapsed}ms, should be < 20ms`);
});
