/* eslint-env worker */
/**
 * Timelines Dagre 异步布局 Web Worker
 *
 * 负责在独立工作线程中计算大图的节点拓扑与坐标布局，
 * 避免复杂图 Dagre 计算冻结主线程渲染。
 */

let dagreLib = null;

function ensureDagre() {
    if (dagreLib) return dagreLib;
    if (typeof dagre !== 'undefined') {
        dagreLib = dagre;
        return dagreLib;
    }
    if (typeof self !== 'undefined' && self.dagre) {
        dagreLib = self.dagre;
        return dagreLib;
    }
    try {
        importScripts('../dagre.js');
        if (typeof self !== 'undefined' && self.dagre) {
            dagreLib = self.dagre;
            return dagreLib;
        }
    } catch (e) {
        // 外部环境可能通过其他方式注入
    }
    return null;
}

self.onmessage = function (event) {
    const { id, type, nodes, edges, layoutOptions } = event.data || {};
    if (type !== 'CALCULATE_LAYOUT') return;

    try {
        const lib = ensureDagre();
        if (!lib || !lib.graphlib || !lib.layout) {
            throw new Error('Worker 中未找到可用的 Dagre 库实例');
        }

        const g = new lib.graphlib.Graph({ multigraph: true, compound: true });
        g.setGraph({
            rankdir: layoutOptions?.rankDir || 'LR',
            nodesep: Number(layoutOptions?.nodeSep) || 50,
            edgesep: Number(layoutOptions?.edgeSep) || 10,
            ranksep: Number(layoutOptions?.rankSep) || 50,
            align: layoutOptions?.align || 'UL',
            ranker: layoutOptions?.ranker || 'network-simplex',
            acyclicer: layoutOptions?.acyclicer || 'greedy',
        });
        g.setDefaultEdgeLabel(() => ({}));
        g.setDefaultNodeLabel(() => ({}));

        for (const n of nodes || []) {
            g.setNode(n.id, {
                width: Number(n.width) || 30,
                height: Number(n.height) || 30,
            });
        }

        for (const e of edges || []) {
            g.setEdge(e.source, e.target, {}, e.id);
        }

        lib.layout(g);

        const positions = {};
        for (const nodeId of g.nodes()) {
            const nodeModel = g.node(nodeId);
            if (nodeModel) {
                positions[nodeId] = {
                    x: Math.round(nodeModel.x),
                    y: Math.round(nodeModel.y),
                };
            }
        }

        self.postMessage({ id, type: 'LAYOUT_SUCCESS', positions });
    } catch (err) {
        self.postMessage({ id, type: 'LAYOUT_ERROR', error: String(err?.message || err) });
    }
};
