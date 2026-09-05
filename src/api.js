/**
 * Timelines 公开 API 模块
 * 遵循 Luker 标准扩展接口规范，向宿主环境注册 timelines 插件 API：
 * Luker.getContext().registerExtensionApi('timelines', api)
 *
 * 供其他插件（如向量检索、记忆插件、分支分析工具）主动读取时间树拓扑、
 * 追溯因果祖先链与计算最近公共祖先 (LCA)。
 */

/**
 * 纯算法：从图谱元素数组中解析父子关系，获取指定节点的祖先因果链 (从 root 到 targetNodeId)
 * @param {Array<object>} elements - Cytoscape elements (nodes and edges)
 * @param {string} targetNodeId
 * @returns {Array<string>} 节点 ID 列表，从 root 依次到 targetNodeId
 */
export function getLineageFromElements(elements, targetNodeId) {
  if (!Array.isArray(elements) || !targetNodeId) return [];

  // 构建 target -> source 的入边映射 (tree/dag 结构中每个节点最多指向其父节点)
  const parentMap = new Map();
  for (const el of elements) {
    const data = el.data || el;
    if (data.source && data.target) {
      // data.source 是父节点，data.target 是子节点
      parentMap.set(data.target, data.source);
    }
  }

  const lineage = [];
  let curr = targetNodeId;
  const visited = new Set();

  while (curr && !visited.has(curr)) {
    visited.add(curr);
    lineage.unshift(curr); // 往前插入
    curr = parentMap.get(curr);
  }

  return lineage;
}

/**
 * 纯算法：计算两个节点祖先因果链的最近公共祖先 (LCA)
 * @param {Array<string>} lineageA - 节点 A 的祖先链 (从 root 开始)
 * @param {Array<string>} lineageB - 节点 B 的祖先链 (从 root 开始)
 * @returns {string|null} 最近公共祖先节点 ID，若无公共节点则返回 null
 */
export function computeLowestCommonAncestor(lineageA, lineageB) {
  if (!Array.isArray(lineageA) || !Array.isArray(lineageB)) return null;
  if (lineageA.length === 0 || lineageB.length === 0) return null;

  let lca = null;
  const minLen = Math.min(lineageA.length, lineageB.length);

  for (let i = 0; i < minLen; i++) {
    if (lineageA[i] === lineageB[i]) {
      lca = lineageA[i];
    } else {
      break;
    }
  }

  return lca;
}

/**
 * 纯算法：提取指定聊天文件对应的分支节点列表并按楼层顺序排序
 * @param {Array<object>} elements
 * @param {string} chatFileName
 * @returns {Array<object>} 排序后的节点数据数组
 */
export function getChatBranchNodes(elements, chatFileName) {
  if (!Array.isArray(elements) || !chatFileName) return [];

  const nodes = [];
  const cleanName = chatFileName.endsWith('.jsonl') ? chatFileName.slice(0, -6) : chatFileName;

  for (const el of elements) {
    const data = el.data || el;
    if (!data.id || data.id === 'root' || data.source) continue;

    if (data.chat_sessions && typeof data.chat_sessions === 'object') {
      const sessionKeys = Object.keys(data.chat_sessions);
      const matchedKey = sessionKeys.find(k => k === chatFileName || k === cleanName || k === `${cleanName}.jsonl`);
      if (matchedKey) {
        nodes.push({
          id: data.id,
          messageId: data.messageId ?? data.chat_sessions[matchedKey].messageId,
          text: data.text || '',
          name: data.name || '',
          is_user: !!data.is_user,
          chatSession: data.chat_sessions[matchedKey],
        });
      }
    }
  }

  nodes.sort((a, b) => (Number(a.messageId) || 0) - (Number(b.messageId) || 0));
  return nodes;
}

// 内部状态维护
let _currentGraphElements = [];
let _activeChatFileName = '';
const _branchSwitchListeners = new Set();

/**
 * 更新 Timelines 当前内存中的图谱与活动会话状态（供 timeline.js 驱动调用）
 * @param {Array<object>} elements
 * @param {string} activeChat
 */
export function setTimelineGraphState(elements, activeChat) {
  _currentGraphElements = Array.isArray(elements) ? elements : [];
  if (activeChat) _activeChatFileName = activeChat;
}

/**
 * 触发分支切换事件通知
 * @param {string} chatFileName
 * @param {string} [nodeId]
 */
export function notifyBranchSwitched(chatFileName, nodeId = null) {
  _activeChatFileName = chatFileName;
  for (const listener of _branchSwitchListeners) {
    try {
      listener({ chatFileName, nodeId });
    } catch (err) {
      console.warn('[Timelines] 分支切换监听器执行出错:', err);
    }
  }
}

/**
 * 注册 Timelines 对外扩展 API 至 Luker 上下文
 * @param {object} [customContext]
 */
export function registerTimelinesExtensionApi(customContext = null) {
  const attemptRegister = () => {
    try {
      const ctx = customContext || window.Luker?.getContext?.();
      if (!ctx || typeof ctx.registerExtensionApi !== 'function') {
        return false;
      }

      const timelinesApi = {
        version: '1.2.0',
      /**
       * 获取当前时间树图谱的所有 Cytoscape 元素拓扑
       */
      getTimelineTree: () => {
        return structuredClone ? structuredClone(_currentGraphElements) : JSON.parse(JSON.stringify(_currentGraphElements));
      },

      /**
       * 追溯指定节点从根到自身的因果祖先链
       * @param {string} nodeId
       */
      getBranchLineage: (nodeId) => {
        return getLineageFromElements(_currentGraphElements, nodeId);
      },

      /**
       * 计算两个时间树节点的最近公共祖先 (LCA)
       * @param {string} nodeAId
       * @param {string} nodeBId
       */
      computeBranchLCA: (nodeAId, nodeBId) => {
        const lineageA = getLineageFromElements(_currentGraphElements, nodeAId);
        const lineageB = getLineageFromElements(_currentGraphElements, nodeBId);
        return computeLowestCommonAncestor(lineageA, lineageB);
      },

      /**
       * 获取当前活动分支的所有消息节点（按楼层排序）
       * @param {string} [chatFileName] - 缺省则为当前打开的分支
       */
      getBranchNodes: (chatFileName = null) => {
        const target = chatFileName || _activeChatFileName;
        return getChatBranchNodes(_currentGraphElements, target);
      },

      /**
       * 监听用户在时间树中切换分支事件
       * @param {Function} callback - ({ chatFileName, nodeId }) => void
       * @returns {Function} 取消监听函数
       */
      onBranchSwitched: (callback) => {
        if (typeof callback === 'function') {
          _branchSwitchListeners.add(callback);
          return () => _branchSwitchListeners.delete(callback);
        }
        return () => {};
      },
    };

      ctx.registerExtensionApi('timelines', Object.freeze(timelinesApi));
      return true;
    } catch (err) {
      console.warn('[Timelines] 注册扩展 API 失败:', err);
      return false;
    }
  };

  const success = attemptRegister();
  if (!success && typeof window !== 'undefined') {
    setTimeout(attemptRegister, 200);
    setTimeout(attemptRegister, 1500);
  }
  return success;
}
