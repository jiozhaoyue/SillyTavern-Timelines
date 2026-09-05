/**
 * @file lod-service.js
 * @description 超大时间树 LOD (Level of Detail) 拓扑抽稀与分级渲染服务
 * 纯函数式拓扑分析：在保持分叉树因果图结构完整的前提下，自动折叠超长连续单链非关键节点。
 */

/**
 * 校验节点是否属于不可折叠的关键保护节点
 *
 * @param {Object} node - Cytoscape 节点对象或数据
 * @param {Set<string>} protectedNodeIds - 外部传入的保护节点 ID 集合
 * @returns {boolean}
 */
export function isProtectedNode(node, protectedNodeIds = new Set()) {
    if (!node || !node.data) return true;
    const d = node.data;
    const id = d.id;

    if (protectedNodeIds && protectedNodeIds.has(id)) return true;
    if (d.label === 'root' || d.isRoot) return true;
    if (d.isBookmark) return true;
    if (d.hasMemory || d.injectionStatus) return true;
    if (d.isCurrent || d.isActive) return true;
    // 多 swipe 分支的首节点或用户正在查看的 swipe
    if (d.isSwipe || (typeof d.totalSwipes === 'number' && d.totalSwipes > 1)) return true;

    return false;
}

/**
 * 寻找可折叠的长线性单链 (Collapsible Chains)
 *
 * @param {Array} elements - Cytoscape 节点与边原始数组
 * @param {Object} [options={}] - 配置参数
 * @param {number} [options.minChainLength=10] - 触发折叠的最小连续单链长度
 * @param {Set<string>} [options.protectedNodeIds=new Set()] - 受保护的节点 ID 集合
 * @returns {Array<Object>} 识别出的折叠簇描述列表
 */
export function findCollapsibleChains(elements, options = {}) {
    const minChainLength = options.minChainLength || 10;
    const protectedNodeIds = options.protectedNodeIds || new Set();

    if (!Array.isArray(elements) || elements.length === 0) {
        return [];
    }

    const nodeMap = new Map();
    const inEdges = new Map();
    const outEdges = new Map();

    for (const ele of elements) {
        if (!ele || !ele.data) continue;
        if (ele.group === 'nodes' || (!ele.group && !ele.data.source && !ele.data.target)) {
            nodeMap.set(ele.data.id, ele);
            if (!inEdges.has(ele.data.id)) inEdges.set(ele.data.id, []);
            if (!outEdges.has(ele.data.id)) outEdges.set(ele.data.id, []);
        } else if (ele.group === 'edges' || (!ele.group && ele.data.source && ele.data.target)) {
            const { source, target } = ele.data;
            if (!outEdges.has(source)) outEdges.set(source, []);
            outEdges.get(source).push(ele);

            if (!inEdges.has(target)) inEdges.set(target, []);
            inEdges.get(target).push(ele);
        }
    }

    const isCandidate = (id) => {
        const node = nodeMap.get(id);
        if (!node) return false;
        if (isProtectedNode(node, protectedNodeIds)) return false;

        const inCount = inEdges.get(id)?.length || 0;
        const outCount = outEdges.get(id)?.length || 0;
        return inCount === 1 && outCount === 1;
    };

    const visited = new Set();
    const clusters = [];

    for (const [id, node] of nodeMap.entries()) {
        if (visited.has(id) || !isCandidate(id)) continue;

        // 沿入边回溯链头
        let headId = id;
        while (true) {
            const prevEdges = inEdges.get(headId);
            if (!prevEdges || prevEdges.length !== 1) break;
            const prevId = prevEdges[0].data.source;
            if (isCandidate(prevId) && !visited.has(prevId)) {
                headId = prevId;
            } else {
                break;
            }
        }

        // 沿出边顺序收集整条链
        const chain = [];
        let currId = headId;
        while (currId && isCandidate(currId) && !visited.has(currId)) {
            visited.add(currId);
            chain.push(currId);
            const nextEdges = outEdges.get(currId);
            if (nextEdges && nextEdges.length === 1) {
                currId = nextEdges[0].data.target;
            } else {
                break;
            }
        }

        if (chain.length >= minChainLength) {
            const firstId = chain[0];
            const lastId = chain[chain.length - 1];

            const inEdge = inEdges.get(firstId)?.[0];
            const outEdge = outEdges.get(lastId)?.[0];

            if (inEdge && outEdge) {
                const prevNodeId = inEdge.data.source;
                const nextNodeId = outEdge.data.target;

                clusters.push({
                    clusterId: `cluster_${prevNodeId}_${nextNodeId}`,
                    chain,
                    prevNodeId,
                    nextNodeId,
                    inEdgeId: inEdge.data.id,
                    outEdgeId: outEdge.data.id,
                    count: chain.length,
                });
            }
        }
    }

    return clusters;
}

/**
 * 将原始 elements 数组应用 LOD 抽稀折叠
 *
 * @param {Array} rawElements - 原始 Cytoscape elements 数组
 * @param {Set<string>} [expandedClusterIds=new Set()] - 用户手动展开的 clusterId 集合
 * @param {Object} [options={}] - 配置选项
 * @returns {{ elements: Array, clusters: Array, collapsedCount: number }}
 */
export function applyLodToElements(rawElements, expandedClusterIds = new Set(), options = {}) {
    const {
        enabled = true,
        minChainLength = 10,
        minTotalNodes = 50,
        force = false,
        protectedNodeIds = new Set(),
    } = options;

    if (!enabled || !Array.isArray(rawElements) || rawElements.length === 0) {
        return { elements: rawElements || [], clusters: [], collapsedCount: 0 };
    }

    const totalNodeCount = rawElements.filter(e => e.group === 'nodes' || (!e.group && !e.data.source && !e.data.target)).length;
    if (totalNodeCount < minTotalNodes && !force) {
        return { elements: rawElements, clusters: [], collapsedCount: 0 };
    }

    const clusters = findCollapsibleChains(rawElements, { minChainLength, protectedNodeIds });
    if (clusters.length === 0) {
        return { elements: rawElements, clusters: [], collapsedCount: 0 };
    }

    // 过滤出真正需要折叠的簇（排除已被展开的）
    const activeClusters = clusters.filter(c => !expandedClusterIds || !expandedClusterIds.has(c.clusterId));
    if (activeClusters.length === 0) {
        return { elements: rawElements, clusters, collapsedCount: 0 };
    }

    const nodesToRemove = new Set();
    const edgesToRemove = new Set();
    const syntheticNodes = [];
    const syntheticEdges = [];
    let totalCollapsedNodes = 0;

    for (const cluster of activeClusters) {
        for (const nid of cluster.chain) {
            nodesToRemove.add(nid);
        }
        totalCollapsedNodes += cluster.chain.length;

        // 合成折叠节点
        syntheticNodes.push({
            group: 'nodes',
            data: {
                id: cluster.clusterId,
                label: `+${cluster.count} 轮`,
                isCollapsedCluster: true,
                clusterId: cluster.clusterId,
                collapsedCount: cluster.count,
                collapsedNodeIds: cluster.chain,
                prevNodeId: cluster.prevNodeId,
                nextNodeId: cluster.nextNodeId,
                nodeWidth: 56,
                nodeHeight: 24,
            },
        });

        // 桥接有向边
        syntheticEdges.push({
            group: 'edges',
            data: {
                id: `lod_edge_${cluster.prevNodeId}_${cluster.clusterId}`,
                source: cluster.prevNodeId,
                target: cluster.clusterId,
                isCollapsedBridge: true,
            },
        });
        syntheticEdges.push({
            group: 'edges',
            data: {
                id: `lod_edge_${cluster.clusterId}_${cluster.nextNodeId}`,
                source: cluster.clusterId,
                target: cluster.nextNodeId,
                isCollapsedBridge: true,
            },
        });
    }

    // 重构结果 elements
    const resultElements = [];
    for (const ele of rawElements) {
        if (!ele || !ele.data) continue;
        const isNode = ele.group === 'nodes' || (!ele.group && !ele.data.source && !ele.data.target);
        if (isNode) {
            if (!nodesToRemove.has(ele.data.id)) {
                resultElements.push(ele);
            }
        } else {
            // 边
            const { source, target } = ele.data;
            if (!nodesToRemove.has(source) && !nodesToRemove.has(target)) {
                resultElements.push(ele);
            }
        }
    }

    resultElements.push(...syntheticNodes, ...syntheticEdges);

    return {
        elements: resultElements,
        clusters,
        collapsedCount: totalCollapsedNodes,
    };
}
