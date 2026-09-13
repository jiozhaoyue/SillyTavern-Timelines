import { characters, getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { timelinesCache } from './cache.js';
import {
  buildGraph,
  convertToCytoscapeElements,
  createNode,
  generateUniqueColor,
  groupMessagesByContent,
  preprocessChatSessions,
  sfc32,
} from './graph-builder.js';

export {
  buildGraph,
  convertToCytoscapeElements,
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
/** 缓存回放分块大小：每批回调后让出主线程，保证渐进渲染与进度条流畅 */
const CACHE_REPLAY_CHUNK = 8;

function getTimelinesContext() {
  return window.Luker?.getContext?.() ?? getContext();
}

/**
 * 让出主线程一帧（宏任务级），供渐进渲染更新画面与进度条。
 *
 * @returns {Promise<void>}
 */
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
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

  const response = await fetchWithTimeout(
    '/api/characters/chats',
    {
      method: 'POST',
      body: JSON.stringify({ avatar_url: characterAvatar }),
      headers: getRequestHeaders(),
    },
    chatFetchTimeoutMs,
  );
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

    const chatResponse = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: getRequestHeaders(),
        body: requestBody,
        cache: 'no-cache',
      },
      chatFetchTimeoutMs,
    );

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
 * 渐进式数据准备管线：以单文件粒度产出会话数据，供上层增量渲染与进度上报。
 *
 * 加载顺序：当前活跃会话最先（先渲染用户所在分支）→ 缓存命中分块回放 → 网络并发拉取。
 * 每个文件就绪即触发 `onBatch`，并附带 `onProgress` 阶段上报。
 *
 * @async
 * @param {Object} data - 聊天列表元数据（fetchData 的输出）。
 * @param {boolean} isGroupChat - 是否为群聊。
 * @param {Object} [options]
 * @param {boolean} [options.forceReload=false] - 强制清空本地缓存并全量拉取。
 * @param {number|null} [options.concurrency=null] - 网络拉取并发；null 用模块默认值。
 * @param {Function|null} [options.onBatch=null] - (fileName, messages) => void，单文件粒度回调。
 * @param {Function|null} [options.onProgress=null] - (phase, {done, total, detail}) => void。
 * @param {Object|null} [options.memoryProfile=null] - 设备画像（仅用于并发决策等，由上层统一传递）。
 * @returns {Promise<Array>} 最终的 Cytoscape 元素数组（与旧 prepareData 返回一致）。
 */
export async function prepareDataProgressive(data, isGroupChat, {
  forceReload = false,
  concurrency = null,
  onBatch = null,
  onProgress = null,
  memoryProfile = null,
} = {}) {
  const context = getTimelinesContext();
  const emitBatch = typeof onBatch === 'function' ? onBatch : null;
  const emitProgress = typeof onProgress === 'function' ? onProgress : null;
  const chat_dict = {};
  let chat_list = Object.values(data ?? {})
    .sort((a, b) => a['file_name'].localeCompare(b['file_name']))
    .reverse();
  const deadline = Date.now() + prepareDataTimeoutMs;
  const effectiveConcurrency = Number(concurrency) > 0 ? Number(concurrency) : chatFetchConcurrency;

  if (chat_list.length === 0) {
    return convertToCytoscapeElements(chat_dict, memoryProfile);
  }

  const scopeKey = isGroupChat ? `group_${context.groupId || 'unknown'}` : `char_${context.characterId ?? 'unknown'}`;

  if (forceReload) {
    console.info(`Timelines: 强制刷新，清除作用域 ${scopeKey} 的本地缓存。`);
    await timelinesCache.clearScope(scopeKey);
  }

  const character = context.characters?.[context.characterId] ?? characters?.[context.characterId];
  if (!isGroupChat && !character) {
    console.error('Timelines: 找不到当前角色信息，无法加载单人聊天文件。');
    return convertToCytoscapeElements(chat_dict, memoryProfile);
  }

  const reportProgress = (done, total, detail) => {
    if (emitProgress) {
      emitProgress('data', { done, total, detail });
    }
  };

  // 1. 批量检索本地 IndexedDB 缓存（命中清单与消息一次取回，后续分块回放）
  const fileNames = chat_list.map(c => c.file_name);
  const cachedMap = forceReload ? new Map() : await timelinesCache.getBatchChats(scopeKey, fileNames);

  // 2. 区分当前活跃聊天 / 缓存命中 / 待网络拉取
  const activeChatId = String(context.chatId ?? context.chatMetadata?.file_name ?? '').replace('.jsonl', '');
  const activeFileName = chat_list.find(item => item.file_name.replace('.jsonl', '') === activeChatId)?.file_name ?? null;
  const cachedFiles = [];
  const filesToFetch = [];

  for (const item of chat_list) {
    const fileName = item.file_name;
    const baseName = fileName.replace('.jsonl', '');
    if (baseName === activeChatId && Array.isArray(context.chat) && context.chat.length > 0) {
      continue; // 活跃会话单独最先处理
    }
    if (cachedMap.has(fileName)) {
      cachedFiles.push(fileName);
    } else {
      filesToFetch.push(item);
    }
  }

  const totalCount = chat_list.length;
  let doneCount = 0;

  // 3. 当前活跃聊天最先入批（用户正在聊的分支优先出现在画布上）
  if (activeFileName) {
    const activeMessages = isGroupChat ? context.chat : context.chat.slice(1);
    chat_dict[activeFileName] = activeMessages;
    doneCount += 1;
    reportProgress(doneCount, totalCount, `${activeFileName}（当前会话）`);
    if (emitBatch) {
      emitBatch(activeFileName, activeMessages);
    }
    timelinesCache.setChat(scopeKey, activeFileName, activeMessages).catch(() => {});
    await yieldToUI();
  }

  // 4. 缓存命中分块回放（每块之间让出主线程，渐进上屏）
  for (let i = 0; i < cachedFiles.length; i += CACHE_REPLAY_CHUNK) {
    if (emitProgress && i > 0) {
      await yieldToUI();
    }
    const chunk = cachedFiles.slice(i, i + CACHE_REPLAY_CHUNK);
    for (const fileName of chunk) {
      const cachedEntry = cachedMap.get(fileName);
      chat_dict[fileName] = cachedEntry.messages;
      doneCount += 1;
      reportProgress(doneCount, totalCount, `${fileName}（缓存）`);
      if (emitBatch) {
        emitBatch(fileName, cachedEntry.messages);
      }
    }
  }
  // 释放批量缓存引用（消息本体已由 chat_dict 持有，无拷贝）
  cachedMap.clear();

  const hitCount = cachedFiles.length + (activeFileName ? 1 : 0);
  if (hitCount > 0) {
    console.info(
      `Timelines: 增量缓存命中 ${hitCount}/${totalCount} 个文件，需网络拉取 ${filesToFetch.length} 个文件。`,
    );
  } else {
    console.info(`Timelines: 正在加载全部 ${totalCount} 个聊天文件。`);
  }

  // 5. 网络拉取：每完成一个文件立即入批（不等整批），并发受画像约束
  if (filesToFetch.length > 0) {
    await mapWithConcurrencyLimit(
      filesToFetch,
      effectiveConcurrency,
      async ({ file_name }) => {
        const loadedChat = await fetchChatFile({
          file_name,
          isGroupChat,
          character,
        });
        if (loadedChat) {
          chat_dict[loadedChat.file_name] = loadedChat.messages;
          doneCount += 1;
          reportProgress(doneCount, totalCount, `${loadedChat.file_name}（网络）`);
          if (emitBatch) {
            emitBatch(loadedChat.file_name, loadedChat.messages);
          }
          // 写入本地持久化缓存
          timelinesCache.setChat(scopeKey, loadedChat.file_name, loadedChat.messages).catch(() => {});
        } else {
          doneCount += 1;
          reportProgress(doneCount, totalCount, `${file_name}（失败跳过）`);
        }
        return null;
      },
      deadline,
    );
  }

  const loadedCount = Object.keys(chat_dict).length;
  if (loadedCount < totalCount) {
    console.warn(`Timelines: 已加载 ${loadedCount}/${totalCount} 个聊天文件，剩余文件因超时或失败被跳过。`);
  } else {
    console.info(`Timelines: 全部 ${loadedCount} 个聊天文件准备就绪。`);
  }

  return convertToCytoscapeElements(chat_dict, memoryProfile);
}

/**
 * 兼容包装：一次性准备全部数据并转为 Cytoscape 元素（旧签名与行为不变）。
 *
 * @async
 * @param {Object} data - 聊天列表元数据。
 * @param {boolean} isGroupChat - 是否为群聊。
 * @param {boolean} [forceReload=false] - 强制刷新缓存。
 * @returns {Promise<Array>} Cytoscape 元素数组。
 */
export async function prepareData(data, isGroupChat, forceReload = false) {
  return await prepareDataProgressive(data, isGroupChat, { forceReload });
}

/**
 * 解析节点的全文文本（细腰图按需取）。
 *
 * 省内存模式下节点 msg 为截断预览；此函数经 chat_sessions 定位到 (会话, 楼层)，
 * 从 IndexedDB 缓存解析原始消息返回全文。未截断节点直接返回 msg。
 *
 * @param {Object} nodeData - 图谱节点数据（含 chat_sessions / msgTruncated）。
 * @returns {Promise<string>} 全文文本（解析失败时回退为节点预览）。
 */
export async function getFullNodeText(nodeData) {
  const preview = String(nodeData?.msg ?? '');
  if (!nodeData?.msgTruncated) {
    return preview;
  }
  const sessions = nodeData?.chat_sessions ?? {};
  const entries = Object.entries(sessions);
  if (entries.length === 0) {
    return preview;
  }
  const [fileName, session] = entries[0];
  const context = getTimelinesContext();
  const scopeKey = !context?.characterId
    ? `group_${context?.groupId || 'unknown'}`
    : `char_${context.characterId ?? 'unknown'}`;
  try {
    const cached = await timelinesCache.getChat(scopeKey, fileName);
    const messages = Array.isArray(cached?.messages) ? cached.messages : [];
    const index = Number(session?.indexInGroup ?? session?.messageId ?? -1);
    const text = messages[index]?.mes;
    return typeof text === 'string' && text ? text : preview;
  } catch {
    return preview;
  }
}
