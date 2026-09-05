/**
 * Timelines <-> memory-graph 联动服务
 * 封装与 Luker 官方 memory-graph 扩展的只读与只写 API 交互。
 * 具备安全的降级处理与空保护，当宿主未启用 memory-graph 时绝不阻塞时间树主逻辑。
 */

/**
 * 安全解析 memory-graph 的公开 API 接口对象
 * @param {object} [customContext]
 * @returns {object|null}
 */
export function getMemoryGraphApi(customContext = null) {
  try {
    const ctx = customContext || window.Luker?.getContext?.();
    if (ctx && typeof ctx.getExtensionApi === 'function') {
      const api = ctx.getExtensionApi('memory-graph');
      if (api && typeof api === 'object') {
        return api;
      }
    }
  } catch (err) {
    console.warn('[Timelines] 探测 memory-graph 扩展接口失败:', err);
  }
  return null;
}

/**
 * 检查当前运行环境是否激活了 memory-graph
 * @param {object} [customContext]
 * @returns {boolean}
 */
export function isMemoryGraphAvailable(customContext = null) {
  return getMemoryGraphApi(customContext) !== null;
}

/**
 * 查询指定消息楼层（messageIndex）对应的记忆事件束 (Event + Location + Characters)
 * @param {object} context - Luker/ST context
 * @param {number} messageIndex - 消息楼层索引 (0-based)
 * @param {object} [mockApi] - 测试用注入 API
 * @returns {Promise<{event: object, location: object|null, characters: Array<object>}|null>}
 */
export async function getMemoryBundleForMessage(context, messageIndex, mockApi = null) {
  const api = mockApi || getMemoryGraphApi(context);
  if (!api) return null;

  try {
    const idx = Number(messageIndex);
    if (!Number.isFinite(idx) || idx < 0) return null;

    let seq = null;
    if (typeof api.getAssistantSeqForMessageIndex === 'function') {
      seq = api.getAssistantSeqForMessageIndex(context, idx);
    } else {
      // 降级回退：假定每 2 楼一次回复 (1-based)
      seq = Math.max(1, Math.floor((idx + 1) / 2));
    }

    if (!seq || seq <= 0) return null;

    if (typeof api.findEventBundleBySeq === 'function') {
      const bundle = await api.findEventBundleBySeq(context, seq);
      return bundle || null;
    } else if (typeof api.findEventBySeq === 'function') {
      const event = await api.findEventBySeq(context, seq);
      return event ? { event, location: null, characters: [] } : null;
    }
  } catch (err) {
    console.warn(`[Timelines] 查询楼层 ${messageIndex} 记忆束失败:`, err);
  }
  return null;
}

/**
 * 获取当前 Prompt 注入状态 (always / recall / visible / none)
 * @param {object} context
 * @param {string} eventId
 * @param {object} [mockApi]
 * @returns {'always' | 'recall' | 'visible' | 'none'}
 */
export function getEventInjectionStatus(context, eventId, mockApi = null) {
  if (!eventId) return 'none';
  const api = mockApi || getMemoryGraphApi(context);
  if (!api || typeof api.getCurrentInjection !== 'function') return 'none';

  try {
    const injection = api.getCurrentInjection(context);
    if (!injection) return 'none';

    const cleanId = String(eventId).trim();
    if (injection.alwaysInjectIds && hasId(injection.alwaysInjectIds, cleanId)) {
      return 'always';
    }
    if (injection.recallSelectedIds && hasId(injection.recallSelectedIds, cleanId)) {
      return 'recall';
    }
    if (injection.visibleIds && hasId(injection.visibleIds, cleanId)) {
      return 'visible';
    }
  } catch (err) {
    console.warn('[Timelines] 获取事件注入状态失败:', err);
  }
  return 'none';
}

function hasId(container, id) {
  if (container instanceof Set) return container.has(id);
  if (Array.isArray(container)) return container.includes(id);
  if (container && typeof container.has === 'function') return container.has(id);
  return false;
}

/**
 * 批量为图谱节点构建记忆元数据索引
 * @param {object} context
 * @param {Array<object>} cyElements - Cytoscape elements (nodes)
 * @param {object} [mockApi]
 * @returns {Promise<Map<string, {hasMemory: boolean, bundle: object|null, injectionStatus: string}>>}
 */
export async function buildMemoryIndexForGraph(context, cyElements, mockApi = null) {
  const result = new Map();
  const api = mockApi || getMemoryGraphApi(context);
  if (!api || !Array.isArray(cyElements)) return result;

  const nodeElements = cyElements.filter(el => el.group === 'nodes' || (!el.group && el.data && !el.data.source));

  for (const node of nodeElements) {
    const data = node.data || node;
    const nodeId = data.id;
    if (!nodeId || nodeId === 'root') continue;

    const messageId = Number.isFinite(Number(data.messageId)) ? Number(data.messageId) : null;
    if (messageId === null) continue;

    try {
      const bundle = await getMemoryBundleForMessage(context, messageId, api);
      if (bundle && bundle.event) {
        const status = getEventInjectionStatus(context, bundle.event.id, api);
        result.set(nodeId, {
          hasMemory: true,
          bundle,
          injectionStatus: status,
        });
      }
    } catch (e) {
      // 容错处理
    }
  }

  return result;
}

/**
 * 快速在 memory-graph 中为指定节点追加记忆事件
 * @param {object} context
 * @param {object} params
 * @param {number} params.messageIndex - 关联楼层
 * @param {string} params.title - 记忆标题
 * @param {string} params.summary - 记忆内容摘要
 * @param {object} [mockApi]
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
export async function createQuickMemoryEvent(context, { messageIndex, title, summary }, mockApi = null) {
  const api = mockApi || getMemoryGraphApi(context);
  if (!api || typeof api.openSession !== 'function') {
    return { success: false, error: 'memory-graph 插件不可用或未暴露 openSession 接口' };
  }

  try {
    const session = await api.openSession(context);
    if (!session || typeof session.createNode !== 'function') {
      return { success: false, error: '无法创建 memory-graph 读写会话' };
    }

    const res = await session.createNode({
      type: 'event',
      title: title || `第 ${messageIndex} 楼剧情记忆`,
      fields: {
        summary: summary || '',
        floorRange: { start: messageIndex, end: messageIndex },
      },
    });

    return { success: true, id: res?.id };
  } catch (err) {
    console.error('[Timelines] 补录记忆事件失败:', err);
    return { success: false, error: err?.message || String(err) };
  }
}
