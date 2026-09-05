/**
 * @file merge-service.js
 * @description 分支剧情树深度合并与跨分支消息采摘 (Cherry-Pick) 核心服务。
 * 纯逻辑函数设计，100% 契合 SillyTavern 原生聊天消息格式与会话持久化契约。
 */

/**
 * 深度纯净克隆原生消息对象
 *
 * @param {object} msg - 源消息对象
 * @returns {object|null}
 */
export function cloneNativeMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;

  const cloned = {
    name: String(msg.name || ''),
    is_user: Boolean(msg.is_user),
    is_system: Boolean(msg.is_system),
    send_date: msg.send_date || Date.now(),
    mes: String(msg.mes || ''),
    extra: msg.extra && typeof msg.extra === 'object' ? JSON.parse(JSON.stringify(msg.extra)) : {},
  };

  if (Array.isArray(msg.swipes)) {
    cloned.swipes = msg.swipes.map(s => String(s || ''));
  }
  if (typeof msg.swipe_id === 'number') {
    cloned.swipe_id = msg.swipe_id;
  }

  return cloned;
}

/**
 * 将跨分支消息采摘 (Cherry-Pick) 移植到当前活动会话中
 *
 * @param {object} sourceMsg - 待采摘的源消息或节点数据摘要
 * @param {object} [context=null] - 当前酒馆运行上下文
 * @param {object} [options={}]
 * @param {number} [options.targetIndex=-1] - 插入位置（默认 -1 表示追加到末尾）
 * @param {Function} [options.saveFn] - 自定义保存函数 (供单元测试注入)
 * @returns {Promise<{ success: boolean, message?: object, index?: number, error?: string }>}
 */
export async function cherryPickMessageToCurrentChat(sourceMsg, context = null, options = {}) {
  if (!sourceMsg) {
    return { success: false, error: '源消息为空或无效' };
  }

  const ctx = context || (typeof window !== 'undefined' ? (window.Luker?.getContext?.() || window.SillyTavern?.getContext?.()) : null);
  if (!ctx || !Array.isArray(ctx.chat)) {
    return { success: false, error: '当前活动聊天会话未就绪' };
  }

  // 若传入的是 NodeDataSummary 格式，则适配转为原生消息
  const rawMsg = {
    name: sourceMsg.name,
    is_user: sourceMsg.isUser !== undefined ? sourceMsg.isUser : sourceMsg.is_user,
    is_system: sourceMsg.is_system,
    send_date: sourceMsg.send_date,
    mes: sourceMsg.msg !== undefined ? sourceMsg.msg : sourceMsg.mes,
    extra: sourceMsg.extra,
    swipes: sourceMsg.swipes,
    swipe_id: sourceMsg.swipeId !== undefined ? sourceMsg.swipeId : sourceMsg.swipe_id,
  };

  const cloned = cloneNativeMessage(rawMsg);
  if (!cloned) {
    return { success: false, error: '克隆消息失败' };
  }

  // 严格保证不污染第 0 行 (会话元数据)
  const targetIndex = options.targetIndex;
  let finalIndex;
  if (typeof targetIndex === 'number' && targetIndex >= 1 && targetIndex <= ctx.chat.length) {
    ctx.chat.splice(targetIndex, 0, cloned);
    finalIndex = targetIndex;
  } else {
    ctx.chat.push(cloned);
    finalIndex = ctx.chat.length - 1;
  }

  // 触发原生持久化
  const saveFn = options.saveFn || (typeof window !== 'undefined' ? (window.saveChatDebounced || ctx.saveChat) : null);
  if (typeof saveFn === 'function') {
    try {
      await saveFn();
    } catch (err) {
      console.warn('[MergeService] 持久化聊天触发异常:', err);
    }
  }

  // 若处于浏览器环境，触发原生 UI 刷新
  if (typeof window !== 'undefined') {
    try {
      if (typeof window.addOneMessage === 'function') {
        window.addOneMessage(cloned);
      } else if (window.eventSource && window.event_types?.CHAT_CHANGED) {
        window.eventSource.emit(window.event_types.CHAT_CHANGED);
      }
    } catch (e) {
      console.debug('[MergeService] 界面即时刷新静默降级:', e);
    }
  }

  return {
    success: true,
    message: cloned,
    index: finalIndex,
  };
}

/**
 * 合成双分支合并后的消息完整序列
 *
 * @param {object[]} commonPrefix - 公共祖先前缀消息列表 (0 到 LCA)
 * @param {object[]} diffA - 分支 A 独有消息列表
 * @param {object[]} diffB - 分支 B 独有消息列表
 * @param {'APPEND_B_TO_A'|'APPEND_A_TO_B'|'INTERLEAVED'} [strategy='APPEND_B_TO_A'] - 合并策略
 * @returns {object[]} 合成后的消息对象数组
 */
export function synthesizeMergedChatSequence(commonPrefix = [], diffA = [], diffB = [], strategy = 'APPEND_B_TO_A') {
  const cleanPrefix = (Array.isArray(commonPrefix) ? commonPrefix : []).map(cloneNativeMessage).filter(Boolean);
  const cleanA = (Array.isArray(diffA) ? diffA : []).map(cloneNativeMessage).filter(Boolean);
  const cleanB = (Array.isArray(diffB) ? diffB : []).map(cloneNativeMessage).filter(Boolean);

  let mergedBranches = [];

  switch (strategy) {
    case 'APPEND_A_TO_B':
      mergedBranches = [...cleanB, ...cleanA];
      break;

    case 'INTERLEAVED': {
      const maxLen = Math.max(cleanA.length, cleanB.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < cleanA.length) mergedBranches.push(cleanA[i]);
        if (i < cleanB.length) mergedBranches.push(cleanB[i]);
      }
      break;
    }

    case 'APPEND_B_TO_A':
    default:
      mergedBranches = [...cleanA, ...cleanB];
      break;
  }

  return [...cleanPrefix, ...mergedBranches];
}

/**
 * 格式化合并产生的新会话文件名
 *
 * @param {string} [nameA='BranchA'] - 分支 A 标识
 * @param {string} [nameB='BranchB'] - 分支 B 标识
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function generateMergeBranchName(nameA = 'BranchA', nameB = 'BranchB', now = new Date()) {
  const clean = str => String(str || '').replace(/\.jsonl$/i, '').replace(/[^\w\u4e00-\u9fa5_-]/g, '_').slice(0, 20);
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `Merge_${clean(nameA)}_${clean(nameB)}_${timeStr}`;
}
