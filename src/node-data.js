import { characters, getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import {
    buildGraph,
    createNode,
    generateUniqueColor,
    groupMessagesByContent,
    preprocessChatSessions,
    sfc32,
} from './graph-builder.js';
import { timelinesCache } from './cache.js';

export {
    buildGraph,
    createNode,
    generateUniqueColor,
    groupMessagesByContent,
    preprocessChatSessions,
    sfc32,
    timelinesCache,
};

const chatFetchTimeoutMs = 15000;
const prepareDataTimeoutMs = 45000;
const chatFetchConcurrency = 8;

function getTimelinesContext() {
    return window.Luker?.getContext?.() ?? getContext();
}

/**
 * @param {string} characterAvatar - The URL of the character's avatar, used as an identifier to fetch chats.
 * @returns {Promise<Object|undefined>} A promise that resolves with the JSON representation of the chat data
 *                                      or undefined if the fetch request is not successful.
 * @throws Will throw an error if there's an issue with the fetch request itself.
 */
export async function fetchData(characterAvatar) {
    if (!characterAvatar) {
        console.error('Timelines: 当前角色没有头像标识，无法获取聊天列表。');
        return {};
    }

    const response = await fetchWithTimeout('/api/characters/chats', {
        method: 'POST',
        body: JSON.stringify({ avatar_url: characterAvatar }),
        headers: getRequestHeaders(),
    }, chatFetchTimeoutMs);
    if (!response.ok) {
        console.error(`Timelines: 获取角色聊天列表失败，状态码 ${response.status}。`);
        return {};
    }
    return response.json();
}

/**
 * 带超时的 fetch，避免宿主接口无响应时让时间线打开流程一直停在加载中。
 *
 * @param {string} url - 请求地址。
 * @param {Object} options - fetch 选项。
 * @param {number} timeoutMs - 超时时间。
 * @returns {Promise<Response>} fetch 响应。
 */
async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * 以固定并发数量处理数组，避免大量聊天文件让打开时间线时串行等待太久。
 *
 * @param {Array} items - 要处理的项目。
 * @param {number} limit - 最大并发数量。
 * @param {Function} mapper - 单项处理函数。
 * @param {number} deadline - 最晚结束时间戳。
 * @returns {Promise<Array>} 与输入顺序一致的结果数组。
 */
async function mapWithConcurrencyLimit(items, limit, mapper, deadline) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length && Date.now() < deadline) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }

    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}

/**
 * 加载一个聊天文件的完整内容。
 *
 * @param {Object} params - 请求参数。
 * @param {string} params.file_name - 聊天文件名。
 * @param {boolean} params.isGroupChat - 是否为群聊。
 * @param {Object} params.character - 当前角色信息。
 * @returns {Promise<Object|null>} 成功时返回 `{ file_name, messages }`，失败时返回 null。
 */
async function fetchChatFile({ file_name, isGroupChat, character }) {
    try {
        const endpoint = isGroupChat ? '/api/chats/group/get' : '/api/chats/get';
        const requestBody = isGroupChat
            ? JSON.stringify({ id: file_name })
            : JSON.stringify({
                ch_name: character.name,
                file_name: file_name.replace('.jsonl', ''),
                avatar_url: character.avatar,
            });

        const chatResponse = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: requestBody,
            cache: 'no-cache',
        }, chatFetchTimeoutMs);

        if (!chatResponse.ok) {
            console.warn(`Timelines: 加载聊天文件 ${file_name} 失败，状态码 ${chatResponse.status}。`);
            return null;
        }

        const currentChat = await chatResponse.json();
        if (!Array.isArray(currentChat)) {
            console.warn(`Timelines: 聊天文件 ${file_name} 返回的数据不是消息数组，已跳过。`);
            return null;
        }

        if (!isGroupChat) {
            // 单人聊天第一条是元数据，不参与时间线绘制。
            currentChat.shift();
        }

        return { file_name, messages: currentChat };
    } catch (error) {
        const reason = error?.name === 'AbortError' ? '请求超时' : error;
        console.error(`Timelines: 加载聊天文件 ${file_name} 时出错：`, reason);
        return null;
    }
}

/**
 * Prepares chat data by fetching detailed chat content, sorting by file names, and converting
 * the consolidated data into a format suitable for Cytoscape visualization. This function
 * fetches individual or group chat data based on the `isGroupChat` flag.
 *
 * @async
 * @param {Object} data - A dictionary containing summary or metadata of chats.
 * @param {boolean} isGroupChat - A flag indicating whether the chat data is for group chats (true)
 *                                or individual chats (false).
 * @returns {Promise<Array>} A promise that resolves with a list of nodes (and potentially edges)
 *                           suitable for the Cytoscape graph library.
 * @throws Will throw an error if the fetch request or data processing encounters issues.
 */
export async function prepareData(data, isGroupChat, forceReload = false) {
    const context = getTimelinesContext();
    let chat_dict = {};
    let chat_list = Object.values(data ?? {}).sort((a, b) => a['file_name'].localeCompare(b['file_name'])).reverse();
    const deadline = Date.now() + prepareDataTimeoutMs;

    if (chat_list.length === 0) {
        return convertToCytoscapeElements(chat_dict);
    }

    const scopeKey = isGroupChat
        ? `group_${context.groupId || 'unknown'}`
        : `char_${context.characterId ?? 'unknown'}`;

    if (forceReload) {
        console.info(`Timelines: 强制刷新，清除作用域 ${scopeKey} 的本地缓存。`);
        await timelinesCache.clearScope(scopeKey);
    }

    const character = context.characters?.[context.characterId] ?? characters?.[context.characterId];
    if (!isGroupChat && !character) {
        console.error('Timelines: 找不到当前角色信息，无法加载单人聊天文件。');
        return convertToCytoscapeElements(chat_dict);
    }

    // 1. 批量检索本地 IndexedDB 缓存
    const fileNames = chat_list.map(c => c.file_name);
    const cachedMap = forceReload ? new Map() : await timelinesCache.getBatchChats(scopeKey, fileNames);

    // 2. 区分当前活跃聊天与缓存文件
    const activeChatId = String(context.chatId ?? context.chatMetadata?.file_name ?? '').replace('.jsonl', '');
    const filesToFetch = [];

    for (const item of chat_list) {
        const fileName = item.file_name;
        const baseName = fileName.replace('.jsonl', '');
        const isActiveChat = (baseName === activeChatId);

        if (isActiveChat && Array.isArray(context.chat) && context.chat.length > 0) {
            // 当前活跃聊天直接使用内存中的最新会话记录（去除单聊第0条元数据）
            const activeMessages = isGroupChat ? context.chat : context.chat.slice(1);
            chat_dict[fileName] = activeMessages;
            // 异步回写更新本地缓存
            timelinesCache.setChat(scopeKey, fileName, activeMessages).catch(() => {});
        } else if (cachedMap.has(fileName)) {
            // 命中本地缓存，秒级读取！
            chat_dict[fileName] = cachedMap.get(fileName).messages;
        } else {
            // 未缓存文件，加入网络获取清单
            filesToFetch.push(item);
        }
    }

    const hitCount = chat_list.length - filesToFetch.length;
    if (hitCount > 0) {
        console.info(`Timelines: 增量缓存命中 ${hitCount}/${chat_list.length} 个文件，需网络拉取 ${filesToFetch.length} 个文件。`);
    } else {
        console.info(`Timelines: 正在加载全部 ${chat_list.length} 个聊天文件。`);
    }

    // 3. 仅对未命中缓存的文件执行网络请求
    if (filesToFetch.length > 0) {
        const loadedChats = await mapWithConcurrencyLimit(filesToFetch, chatFetchConcurrency, ({ file_name }) => fetchChatFile({
            file_name,
            isGroupChat,
            character,
        }), deadline);

        for (const loadedChat of loadedChats) {
            if (loadedChat) {
                chat_dict[loadedChat.file_name] = loadedChat.messages;
                // 写入本地持久化缓存
                timelinesCache.setChat(scopeKey, loadedChat.file_name, loadedChat.messages).catch(() => {});
            }
        }
    }

    const loadedCount = Object.keys(chat_dict).length;
    if (loadedCount < chat_list.length) {
        console.warn(`Timelines: 已加载 ${loadedCount}/${chat_list.length} 个聊天文件，剩余文件因超时或失败被跳过。`);
    } else {
        console.info(`Timelines: 全部 ${loadedCount} 个聊天文件准备就绪。`);
    }

    return convertToCytoscapeElements(chat_dict);
}
