/**
 * SillyTavern Timelines - Node Full Text Resolver
 * 细腰图节点全文解析纯逻辑（从 IndexedDB 缓存消息中还原节点原始文本）
 *
 * 职责：给定节点数据与缓存的消息数组，还原该节点应展示的全文：
 * - 普通节点 → 楼层消息的 `mes`；
 * - swipe 节点 → 楼层消息 `swipes[swipeId]` 的对应变体文本。
 *
 * 设计约束：本模块必须可在 Node 测试环境独立导入运行，禁止引入宿主依赖。
 */

/**
 * 从缓存消息数组解析节点全文（纯函数）。
 *
 * @param {Object} nodeData - 图谱节点数据（含 chat_sessions / msgTruncated / isSwipe / swipeId）。
 * @param {Array} messages - 缓存中的会话消息数组（已剥离元数据行）。
 * @returns {string|null} 全文文本；无法解析（缓存缺失/索引越界/文本为空）时返回 null，由调用方回退预览。
 */
export function resolveFullTextFromCache(nodeData, messages) {
  if (!nodeData?.msgTruncated) return null;

  const sessions = nodeData?.chat_sessions ?? {};
  const entries = Object.entries(sessions);
  if (entries.length === 0) return null;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const [, session] = entries[0];
  const index = Number(session?.indexInGroup ?? session?.messageId ?? -1);
  if (!Number.isInteger(index) || index < 0 || index >= messages.length) return null;

  const message = messages[index];
  if (!message) return null;

  if (nodeData.isSwipe && nodeData.swipeId != null) {
    const swipes = Array.isArray(message.swipes) ? message.swipes : [];
    const swipeText = swipes[Number(nodeData.swipeId)];
    return typeof swipeText === 'string' && swipeText ? swipeText : null;
  }

  const text = message.mes;
  return typeof text === 'string' && text ? text : null;
}
