/**
 * 转义会被正则表达式解释的字符，用于把用户搜索片段当作普通文本匹配。
 *
 * @param {string} value - 原始搜索片段。
 * @returns {string} 可安全放入 `RegExp` 的文本。
 */
export function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从 CSS 颜色字符串中提取透明度。没有显式 alpha 的颜色按不透明处理。
 *
 * @param {string} color - CSS 颜色字符串。
 * @returns {number} 透明度，范围通常为 0..1。
 */
export function getAlphaFromColor(color) {
    if (!color) {
        return 1;
    }

    const rgbaMatch = String(color).match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d*(?:\.\d+)?)\s*\)/i);
    if (rgbaMatch) {
        return Number(rgbaMatch[1]);
    }

    return 1;
}

/**
 * 生成用于判断时间线数据是否需要刷新的上下文 key。
 *
 * @param {object} context - Luker/ST 上下文。
 * @returns {string} 稳定的上下文快照 key。
 */
export function makeContextKey(context) {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const lastMessage = chat.length > 0 ? chat[chat.length - 1] : {};
    return JSON.stringify({
        characterId: context?.characterId ?? null,
        groupId: context?.groupId ?? null,
        chatId: context?.chatId ?? context?.chatMetadata?.file_name ?? context?.chatMetadata?.chat_id ?? null,
        chatLength: chat.length,
        lastMessageText: lastMessage?.mes ?? '',
        lastMessageDate: lastMessage?.send_date ?? '',
    });
}

/**
 * 返回规范化换行后的消息文本，不修改原消息对象。
 *
 * @param {object} message - 聊天消息对象。
 * @returns {string} 消息文本。
 */
export function normalizeMessageText(message) {
    return String(message?.mes ?? '').replace(/\r\n/g, '\n');
}

/**
 * 深拷贝 swipe 的 extra 数据；两边都缺失时返回空对象。
 *
 * @param {object|undefined} swipeExtra - swipe 自带的 extra。
 * @param {object|undefined} messageExtra - 消息原有的 extra。
 * @returns {object} 可安全写回消息的 extra。
 */
export function cloneSwipeExtra(swipeExtra, messageExtra) {
    const source = swipeExtra ?? messageExtra ?? {};
    return JSON.parse(JSON.stringify(source));
}

/**
 * 转义普通文本用于拼接少量受控 HTML。
 *
 * @param {string} value - 原始文本。
 * @returns {string} HTML 实体转义后的文本。
 */
export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
