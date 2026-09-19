/**
 * SillyTavern Timelines - Search Service
 * 智能全景雷达与多维复合检索纯算法模块
 * 
 * 职责：
 * 1. 解析普通搜索词分词与正则表达式语法（/pattern/flags）。
 * 2. 多维复合条件过滤（文本、角色、书签、自定义标签、Swipes 重试、楼层深度范围）。
 * 3. 纯函数设计，不修改 DOM，不产生持久化副作用。
 */

import { extractNodeTags } from './tag-manager.js';

/**
 * 解析搜索字符串为正则或分词片段
 * 支持 /pattern/flags 格式
 * @param {string} queryString
 * @returns {{ isRegex: boolean, regex?: RegExp, fragments: string[] }}
 */
export function parseSearchQuery(queryString) {
  if (!queryString || typeof queryString !== 'string') {
    return { isRegex: false, fragments: [] };
  }
  const str = queryString.trim();
  if (!str) {
    return { isRegex: false, fragments: [] };
  }

  // 尝试匹配 /pattern/flags
  const regexMatch = str.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      const pattern = regexMatch[1];
      const flags = regexMatch[2] || 'i';
      return {
        isRegex: true,
        regex: new RegExp(pattern, flags),
        fragments: [],
      };
    } catch {
      // 若正则语法非法，降级为普通文本
    }
  }

  // 普通文本分词 (空格分隔，支持 AND 逻辑)
  const fragments = str
    .toLowerCase()
    .split(/\s+/)
    .filter(f => f.length > 0);

  return {
    isRegex: false,
    fragments,
  };
}

/**
 * 判断单个节点是否满足复合筛选条件
 * @param {object} nodeData
 * @param {object} filterOptions
 * @param {object} [parsedQuery]
 * @returns {boolean}
 */
export function matchesNode(nodeData, filterOptions = {}, parsedQuery = null) {
  if (!nodeData) return false;
  if (nodeData.isCluster || nodeData.isLodCluster) return false;

  const queryObj = parsedQuery || parseSearchQuery(filterOptions.query || '');

  // 1. 角色筛选
  const speakerFilter = filterOptions.speakerFilter || 'all';
  if (speakerFilter === 'user' && !nodeData.is_user) return false;
  if (speakerFilter === 'character' && nodeData.is_user) return false;

  // 2. 书签筛选
  if (filterOptions.onlyBookmarks) {
    const isBookmark = Boolean(nodeData.isBookmark || nodeData.bookmark || nodeData.extra?.bookmark || nodeData.swipeExtra?.bookmark);
    if (!isBookmark) return false;
  }

  // 3. 标签筛选
  const tags = extractNodeTags(nodeData);
  if (filterOptions.onlyTagged) {
    if (tags.length === 0) return false;
  }
  if (filterOptions.selectedTag && typeof filterOptions.selectedTag === 'string' && filterOptions.selectedTag.trim()) {
    const targetTag = filterOptions.selectedTag.trim().toLowerCase();
    const hasTag = tags.some(t => t.name.toLowerCase() === targetTag);
    if (!hasTag) return false;
  }

  // 4. 重试 Swipes 筛选
  if (filterOptions.onlySwipes) {
    let swipeCount = 0;
    if (Array.isArray(nodeData.swipes)) {
      swipeCount = nodeData.swipes.length;
    } else if (nodeData.swipe_id != null && Number(nodeData.swipe_id) >= 0) {
      swipeCount = Number(nodeData.swipe_id) + 1;
    }
    if (swipeCount <= 1) return false;
  }

  // 5. 楼层/深度范围
  const floor = nodeData.depth != null ? Number(nodeData.depth) : (nodeData.floor != null ? Number(nodeData.floor) : 0);
  if (filterOptions.minFloor != null && filterOptions.minFloor !== '' && floor < Number(filterOptions.minFloor)) {
    return false;
  }
  if (filterOptions.maxFloor != null && filterOptions.maxFloor !== '' && floor > Number(filterOptions.maxFloor)) {
    return false;
  }

  // 6. 文本匹配 (若有查询词)
  if (queryObj.isRegex && queryObj.regex) {
    const text = String(nodeData.message || nodeData.msg || nodeData.text || '');
    const name = String(nodeData.name || '');
    const tagText = tags.map(t => t.name).join(' ');
    const combined = `${name} ${text} ${tagText}`;
    return queryObj.regex.test(combined);
  }

  if (queryObj.fragments && queryObj.fragments.length > 0) {
    const text = String(nodeData.message || nodeData.msg || nodeData.text || '').toLowerCase();
    const name = String(nodeData.name || '').toLowerCase();
    const tagText = tags.map(t => t.name.toLowerCase()).join(' ');
    const combined = `${name} ${text} ${tagText}`;

    // 所有关键词片段均需命中
    for (const fragment of queryObj.fragments) {
      if (!combined.includes(fragment)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 对节点集合进行多维复合检索
 * @param {Array<object>} nodes
 * @param {object} filterOptions
 * @returns {Array<object>} 匹配的节点列表
 */
export function filterGraphNodes(nodes, filterOptions = {}) {
  if (!Array.isArray(nodes)) return [];
  const parsed = parseSearchQuery(filterOptions.query || '');

  return nodes.filter(n => {
    let d = {};
    if (typeof n.data === 'function') {
      try { d = n.data() || {}; } catch { d = {}; }
    } else {
      d = n.data || n;
    }
    return matchesNode(d, filterOptions, parsed);
  });
}
