/**
 * SillyTavern Timelines - Memory Profile
 * 设备画像判定与细腰图文本截断（纯逻辑，Node 可测）
 *
 * 职责：
 * 1. 依据设备能力（内存/核数/触屏）与用户设置档位（auto/on/off）判定是否启用省内存模式。
 * 2. 节点文本预览截断（细腰图核心：节点只驻留预览，全文按需从缓存解析）。
 *
 * 设计约束：本模块不得静态导入任何宿主模块；navigator 经参数注入。
 */

/** 移动端（省内存开）预览长度 */
export const MOBILE_PREVIEW_CHARS = 160;
/** 桌面端（省内存开）预览长度 */
export const DESKTOP_PREVIEW_CHARS = 240;
/** 预览长度下限（防误配导致提示框空白） */
export const MIN_PREVIEW_CHARS = 40;
/** 移动端网络拉取并发 */
export const MOBILE_FETCH_CONCURRENCY = 4;
/** 桌面端网络拉取并发 */
export const DESKTOP_FETCH_CONCURRENCY = 8;

/**
 * 判定是否弱设备（注入 navigator，便于测试）。
 *
 * @param {object} nav - navigator 形状对象。
 * @returns {boolean}
 */
function isWeakDevice(nav) {
  if (!nav) return false;
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 4;
  const lowCores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
  const coarsePointer =
    typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0 && nav.maxTouchPoints >= 5;
  return lowMemory || lowCores || coarsePointer;
}

/**
 * 解析设备画像与省内存模式。
 *
 * @param {object} [options]
 * @param {object} [options.navigatorOverride] - 注入的 navigator（缺省用全局 navigator）。
 * @param {'auto'|'on'|'off'} [options.mode='auto'] - 设置档位。
 * @returns {{memorySaver: boolean, maxPreviewChars: number, fetchConcurrency: number, reason: string}}
 */
export function detectDeviceProfile({ navigatorOverride = null, mode = 'auto' } = {}) {
  const nav = navigatorOverride ?? (typeof navigator !== 'undefined' ? navigator : null);
  const weak = isWeakDevice(nav);

  let memorySaver;
  let reason;
  if (mode === 'on') {
    memorySaver = true;
    reason = '用户强制开启省内存模式';
  } else if (mode === 'off') {
    memorySaver = false;
    reason = '用户关闭省内存模式';
  } else if (weak) {
    memorySaver = true;
    reason = `弱设备画像自动开启（${[
      typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4 ? `内存 ${nav.deviceMemory}GB` : null,
      typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4 ? `${nav.hardwareConcurrency} 核` : null,
      nav.maxTouchPoints >= 5 ? '触屏设备' : null,
    ]
      .filter(Boolean)
      .join(' / ')})`;
  } else {
    memorySaver = false;
    reason = '设备能力充足';
  }

  return {
    memorySaver,
    maxPreviewChars: memorySaver
      ? weak
        ? MOBILE_PREVIEW_CHARS
        : DESKTOP_PREVIEW_CHARS
      : 0, // 0 = 不截断（保持全量文本，行为与旧版一致）
    fetchConcurrency: weak ? MOBILE_FETCH_CONCURRENCY : DESKTOP_FETCH_CONCURRENCY,
    reason,
  };
}

/**
 * 节点文本预览截断（纯函数）。
 *
 * @param {string} text - 原始文本。
 * @param {number} maxChars - 最大字符数（下限 MIN_PREVIEW_CHARS）。
 * @returns {{text: string, truncated: boolean}} truncated=false 时 text 为原文本。
 */
export function truncateForNode(text, maxChars) {
  const source = String(text ?? '');
  const limit = Math.max(MIN_PREVIEW_CHARS, Number(maxChars) || 0);
  if (limit <= 0 || source.length <= limit) {
    return { text: source, truncated: false };
  }
  return {
    text: `${source.slice(0, limit)}...`,
    truncated: true,
  };
}
