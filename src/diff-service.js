/**
 * @file diff-service.js
 * 提供时间线多分支差异对比与 LCA (Lowest Common Ancestor) 拓扑计算。
 * 纯逻辑函数与宿主环境解耦，便于独立进行自动化单元测试。
 */

/**
 * @typedef {Object} NodeDataSummary
 * @property {string} id - 节点 ID
 * @property {string} name - 发送者姓名
 * @property {string} msg - 消息文本
 * @property {boolean} isUser - 是否为用户消息
 * @property {number} [swipeId] - 当前展示的 Swipe ID
 * @property {number} [totalSwipes] - 该节点总 Swipe 数
 * @property {string} [chatFile] - 所属聊天文件名称
 * @property {number} [messageId] - 消息在会话中的楼层 ID
 */

/**
 * @typedef {Object} BranchDiffResult
 * @property {NodeDataSummary|null} lcaNode - 最近公共祖先节点（分叉点），若无交集则为 null
 * @property {number} commonDepth - 分叉点所在深度（从 0 开始）
 * @property {NodeDataSummary[]} diffA - 分支 A 在分叉点之后的独有节点列表
 * @property {NodeDataSummary[]} diffB - 分支 B 在分叉点之后的独有节点列表
 * @property {Object} stats - 统计信息
 * @property {number} stats.depthA - 分支 A 总深度
 * @property {number} stats.depthB - 分支 B 总深度
 * @property {number} stats.diffACount - 分支 A 独有消息数
 * @property {number} stats.diffBCount - 分支 B 独有消息数
 */

/**
 * 提取简化节点摘要
 * @param {Object} nodeItem - 节点或节点数据对象
 * @returns {NodeDataSummary}
 */
export function summarizeNode(nodeItem) {
    const data = typeof nodeItem?.data === 'function' ? nodeItem.data() : (nodeItem?.data || nodeItem || {});
    let chatFile = '';
    let messageId = 0;
    if (data.chat_sessions && typeof data.chat_sessions === 'object') {
        const entries = Object.entries(data.chat_sessions);
        if (entries.length > 0) {
            chatFile = entries[0][0];
            messageId = entries[0][1]?.messageId ?? 0;
        }
    }
    return {
        id: String(data.id || ''),
        name: String(data.name || (data.is_user ? 'User' : 'Character')),
        msg: String(data.msg || ''),
        isUser: Boolean(data.is_user),
        swipeId: data.swipeId ?? 0,
        totalSwipes: Array.isArray(data.storedSwipes) ? data.storedSwipes.length + 1 : 1,
        chatFile,
        messageId,
    };
}

/**
 * 从给定的 Cytoscape 节点向上回溯提取到达根节点的完整路径（正序排列）
 * @param {Object} targetNode - Cytoscape 节点对象
 * @returns {NodeDataSummary[]} 从根节点到目标节点的完整正序链
 */
export function extractPathToRoot(targetNode) {
    if (!targetNode) return [];
    const chain = [];
    let curr = targetNode;
    const visited = new Set();

    while (curr && !visited.has(curr.id())) {
        visited.add(curr.id());
        chain.push(summarizeNode(curr));
        const incomers = curr.incomers?.('edge');
        if (!incomers || incomers.length === 0) {
            break;
        }
        curr = incomers[0].source();
    }

    return chain.reverse();
}

/**
 * 基于两条路径计算最近公共祖先 (LCA) 并切分出各自的差异序列
 * @param {NodeDataSummary[]} pathA - 分支 A 从根到叶的节点链
 * @param {NodeDataSummary[]} pathB - 分支 B 从根到叶的节点链
 * @returns {BranchDiffResult}
 */
export function computeBranchLCA(pathA = [], pathB = []) {
    if (!Array.isArray(pathA)) pathA = [];
    if (!Array.isArray(pathB)) pathB = [];

    const minLen = Math.min(pathA.length, pathB.length);
    let lcaIndex = -1;

    for (let i = 0; i < minLen; i++) {
        const nodeA = pathA[i];
        const nodeB = pathB[i];
        if (nodeA?.id && nodeB?.id && nodeA.id === nodeB.id) {
            lcaIndex = i;
        } else {
            break;
        }
    }

    const lcaNode = lcaIndex >= 0 ? pathA[lcaIndex] : null;
    const diffA = lcaIndex >= 0 ? pathA.slice(lcaIndex + 1) : pathA.slice();
    const diffB = lcaIndex >= 0 ? pathB.slice(lcaIndex + 1) : pathB.slice();

    return {
        lcaNode,
        commonDepth: lcaIndex,
        diffA,
        diffB,
        stats: {
            depthA: pathA.length,
            depthB: pathB.length,
            diffACount: diffA.length,
            diffBCount: diffB.length,
        },
    };
}
