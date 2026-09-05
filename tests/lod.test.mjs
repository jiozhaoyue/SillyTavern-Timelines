import test from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedNode, findCollapsibleChains, applyLodToElements } from '../src/lod-service.js';

test('isProtectedNode respects roots, bookmarks, memories, swipes and protected sets', () => {
    assert.equal(isProtectedNode({ data: { id: 'r', isRoot: true } }), true);
    assert.equal(isProtectedNode({ data: { id: 'b', isBookmark: true } }), true);
    assert.equal(isProtectedNode({ data: { id: 'm', hasMemory: true } }), true);
    assert.equal(isProtectedNode({ data: { id: 's', isSwipe: true } }), true);
    assert.equal(isProtectedNode({ data: { id: 'sw', totalSwipes: 3 } }), true);
    assert.equal(isProtectedNode({ data: { id: 'custom' } }, new Set(['custom'])), true);
    assert.equal(isProtectedNode({ data: { id: 'normal', msg: 'hello' } }), false);
});

test('findCollapsibleChains detects linear chains meeting threshold and excludes endpoints', () => {
    // 构建 root -> n1 -> n2 -> ... -> n12 -> leaf
    const elements = [
        { group: 'nodes', data: { id: 'root', isRoot: true } },
    ];
    for (let i = 1; i <= 12; i++) {
        elements.push({ group: 'nodes', data: { id: `n${i}`, msg: `msg ${i}` } });
    }
    elements.push({ group: 'nodes', data: { id: 'leaf', msg: 'end' } });

    elements.push({ group: 'edges', data: { id: 'e_r_1', source: 'root', target: 'n1' } });
    for (let i = 1; i < 12; i++) {
        elements.push({ group: 'edges', data: { id: `e_${i}_${i+1}`, source: `n${i}`, target: `n${i+1}` } });
    }
    elements.push({ group: 'edges', data: { id: 'e_12_leaf', source: 'n12', target: 'leaf' } });

    // 最小链长 10
    const clusters = findCollapsibleChains(elements, { minChainLength: 10 });
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].count, 12);
    assert.equal(clusters[0].prevNodeId, 'root');
    assert.equal(clusters[0].nextNodeId, 'leaf');
    assert.deepEqual(clusters[0].chain, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11', 'n12']);
});

test('findCollapsibleChains does not collapse when chain is shorter than threshold', () => {
    const elements = [
        { group: 'nodes', data: { id: 'root', isRoot: true } },
        { group: 'nodes', data: { id: 'n1' } },
        { group: 'nodes', data: { id: 'n2' } },
        { group: 'nodes', data: { id: 'leaf' } },
        { group: 'edges', data: { id: 'e1', source: 'root', target: 'n1' } },
        { group: 'edges', data: { id: 'e2', source: 'n1', target: 'n2' } },
        { group: 'edges', data: { id: 'e3', source: 'n2', target: 'leaf' } },
    ];

    const clusters = findCollapsibleChains(elements, { minChainLength: 5 });
    assert.equal(clusters.length, 0);
});

test('findCollapsibleChains protects intermediate milestone/bookmark nodes from collapsing', () => {
    // 12 个节点，中间 n6 是记忆节点，minChainLength = 5
    const elements = [
        { group: 'nodes', data: { id: 'root', isRoot: true } },
    ];
    for (let i = 1; i <= 12; i++) {
        elements.push({
            group: 'nodes',
            data: { id: `n${i}`, hasMemory: i === 6 }
        });
    }
    elements.push({ group: 'nodes', data: { id: 'leaf' } });

    elements.push({ group: 'edges', data: { id: 'e_r_1', source: 'root', target: 'n1' } });
    for (let i = 1; i < 12; i++) {
        elements.push({ group: 'edges', data: { id: `e_${i}_${i+1}`, source: `n${i}`, target: `n${i+1}` } });
    }
    elements.push({ group: 'edges', data: { id: 'e_12_leaf', source: 'n12', target: 'leaf' } });

    // minChainLength = 5: n1..n5 (长5) 和 n7..n12 (长6) 分别满足，n6 得到保留
    const clusters = findCollapsibleChains(elements, { minChainLength: 5 });
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0].prevNodeId, 'root');
    assert.equal(clusters[0].nextNodeId, 'n6');
    assert.equal(clusters[0].count, 5);

    assert.equal(clusters[1].prevNodeId, 'n6');
    assert.equal(clusters[1].nextNodeId, 'leaf');
    assert.equal(clusters[1].count, 6);
});

test('applyLodToElements replaces chain with synthetic node and bridge edges', () => {
    const elements = [
        { group: 'nodes', data: { id: 'root', isRoot: true } },
    ];
    for (let i = 1; i <= 15; i++) {
        elements.push({ group: 'nodes', data: { id: `n${i}` } });
    }
    elements.push({ group: 'nodes', data: { id: 'leaf' } });

    elements.push({ group: 'edges', data: { id: 'e_r_1', source: 'root', target: 'n1' } });
    for (let i = 1; i < 15; i++) {
        elements.push({ group: 'edges', data: { id: `e_${i}_${i+1}`, source: `n${i}`, target: `n${i+1}` } });
    }
    elements.push({ group: 'edges', data: { id: 'e_15_leaf', source: 'n15', target: 'leaf' } });

    const result = applyLodToElements(elements, new Set(), {
        enabled: true,
        minChainLength: 10,
        minTotalNodes: 10,
        force: true,
    });

    assert.equal(result.collapsedCount, 15);
    assert.equal(result.clusters.length, 1);

    // 原始节点 17 (root + 15 + leaf)，折叠后只剩 root + synthetic + leaf = 3
    const nodes = result.elements.filter(e => e.group === 'nodes');
    assert.equal(nodes.length, 3);

    const synthetic = nodes.find(n => n.data.isCollapsedCluster);
    assert.ok(synthetic);
    assert.equal(synthetic.data.label, '+15 轮');
    assert.equal(synthetic.data.prevNodeId, 'root');
    assert.equal(synthetic.data.nextNodeId, 'leaf');

    // 边：仅有 2 条 bridge 边
    const edges = result.elements.filter(e => e.group === 'edges');
    assert.equal(edges.length, 2);
    assert.equal(edges[0].data.source, 'root');
    assert.equal(edges[0].data.target, synthetic.data.id);
    assert.equal(edges[1].data.source, synthetic.data.id);
    assert.equal(edges[1].data.target, 'leaf');
});

test('applyLodToElements respects expandedClusterIds and returns full chain when expanded', () => {
    const elements = [
        { group: 'nodes', data: { id: 'root', isRoot: true } },
    ];
    for (let i = 1; i <= 15; i++) {
        elements.push({ group: 'nodes', data: { id: `n${i}` } });
    }
    elements.push({ group: 'nodes', data: { id: 'leaf' } });

    elements.push({ group: 'edges', data: { id: 'e_r_1', source: 'root', target: 'n1' } });
    for (let i = 1; i < 15; i++) {
        elements.push({ group: 'edges', data: { id: `e_${i}_${i+1}`, source: `n${i}`, target: `n${i+1}` } });
    }
    elements.push({ group: 'edges', data: { id: 'e_15_leaf', source: 'n15', target: 'leaf' } });

    const clusterId = 'cluster_root_leaf';
    const expanded = new Set([clusterId]);

    const result = applyLodToElements(elements, expanded, {
        enabled: true,
        minChainLength: 10,
        minTotalNodes: 10,
        force: true,
    });

    // 因为已被展开，折叠数应为 0，且返回完整 elements
    assert.equal(result.collapsedCount, 0);
    const nodes = result.elements.filter(e => e.group === 'nodes');
    assert.equal(nodes.length, 17);
});
