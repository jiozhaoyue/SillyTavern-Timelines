/**
 * @file story-outline-service.js
 * @description 基于时间线拓扑结构提炼全局因果故事大纲、章节分割算法与 Markdown 导出服务。
 * 纯逻辑函数，非侵入只读提炼，与宿主环境解耦。
 */

import { summarizeNode, extractPathToRoot } from './diff-service.js';

/**
 * @typedef {Object} StoryEvent
 * @property {string} nodeId - 节点 ID
 * @property {number} messageId - 消息楼层索引
 * @property {string} senderName - 发言角色或用户名
 * @property {boolean} isUser - 是否为用户
 * @property {string} textSnippet - 文本缩略摘要 (100字内)
 * @property {string} fullText - 完整消息文本
 * @property {Array<{name: string, color: string}>} tags - 彩色标签列表
 * @property {boolean} isForkPoint - 是否为分歧抉择点 (出度 > 1)
 * @property {boolean} isBookmark - 是否为书签检查点
 * @property {string} [swipeInfo] - Swipe 变种信息
 */

/**
 * @typedef {Object} StoryChapter
 * @property {string} id - 章节 ID
 * @property {string} title - 章节标题
 * @property {number} startFloor - 起始楼层
 * @property {number} endFloor - 结束楼层
 * @property {StoryEvent[]} events - 该章节所包含的事件列表
 */

/**
 * @typedef {Object} StoryOutlineData
 * @property {string} characterName - 角色名
 * @property {string} chatName - 当前会话名
 * @property {StoryChapter[]} chapters - 章节列表
 * @property {Object} stats - 故事宏观统计
 * @property {number} stats.totalEvents - 总事件/消息数
 * @property {number} stats.totalChapters - 章节总数
 * @property {number} stats.totalForks - 剧情转折/分歧点数
 * @property {number} stats.userTurns - 用户发言数
 * @property {number} stats.charTurns - 角色发言数
 * @property {number} stats.approxWords - 预估总字数
 */

/**
 * 截断文本并保留整洁可读的台词摘要
 *
 * @param {string} text - 原始长文本
 * @param {number} [maxLen=120] - 最大长度
 * @returns {string}
 */
export function summarizeTextSnippet(text, maxLen = 120) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

/**
 * 从 Cytoscape 图谱与当前上下文中提炼故事大纲数据
 *
 * @param {object} cy - Cytoscape 实例
 * @param {object} [context=null] - 当前酒馆运行上下文
 * @returns {StoryOutlineData}
 */
export function extractStoryOutline(cy, context = null) {
  const ctx = context || (typeof window !== 'undefined' ? (window.Luker?.getContext?.() || window.SillyTavern?.getContext?.()) : null);
  const characterName = ctx?.characters?.[ctx?.characterId]?.name || '剧情故事';
  const chatName = ctx?.chatId || ctx?.chatMetadata?.file_name || '主线';

  if (!cy || typeof cy.nodes !== 'function') {
    return {
      characterName,
      chatName,
      chapters: [],
      stats: { totalEvents: 0, totalChapters: 0, totalForks: 0, userTurns: 0, charTurns: 0, approxWords: 0 },
    };
  }

  // 1. 寻找当前主链（优先使用与当前聊天关联的节点链，或从叶子向上回溯）
  const allNodes = cy.nodes().filter(n => n.data('label') !== 'root' && !n.data('isCollapsedCluster'));
  if (allNodes.length === 0) {
    return {
      characterName,
      chatName,
      chapters: [],
      stats: { totalEvents: 0, totalChapters: 0, totalForks: 0, userTurns: 0, charTurns: 0, approxWords: 0 },
    };
  }

  // 选取当前分支的最深叶子节点
  let deepestNode = allNodes[allNodes.length - 1];
  let maxDepth = -1;
  allNodes.forEach(node => {
    const d = node.data('depth') ?? 0;
    if (d > maxDepth) {
      maxDepth = d;
      deepestNode = node;
    }
  });

  // 提取正序主干链
  const primaryChain = extractPathToRoot(deepestNode).filter(item => item.id !== 'root');

  // 2. 转换为规范 StoryEvent
  const events = [];
  let userTurns = 0;
  let charTurns = 0;
  let approxWords = 0;
  let totalForks = 0;

  primaryChain.forEach((item, index) => {
    const cyNode = cy.getElementById(item.id);
    const outEdges = cyNode?.outgoers?.('edge') || [];
    const isForkPoint = outEdges.length > 1;
    if (isForkPoint) totalForks++;

    if (item.isUser) userTurns++;
    else charTurns++;

    approxWords += (item.msg || '').length;

    // 提取彩色标签
    const nodeExtra = cyNode?.data?.('extra') || {};
    const rawTags = cyNode?.data?.('tags') || nodeExtra.tags || [];
    const tags = Array.isArray(rawTags)
      ? rawTags.map(t => typeof t === 'string' ? { name: t, color: '#3b82f6' } : { name: t.name || '', color: t.color || '#3b82f6' })
      : [];

    const isBookmark = Boolean(cyNode?.data?.('isBookmark') || cyNode?.data?.('bookmark'));

    events.push({
      nodeId: item.id,
      messageId: item.messageId !== undefined ? item.messageId : index + 1,
      senderName: item.name || (item.isUser ? 'User' : characterName),
      isUser: item.isUser,
      textSnippet: summarizeTextSnippet(item.msg, 120),
      fullText: item.msg || '',
      tags,
      isForkPoint,
      isBookmark,
      swipeInfo: item.totalSwipes > 1 ? `Swipe ${item.swipeId + 1}/${item.totalSwipes}` : undefined,
    });
  });

  // 3. 启发式章节划分 (Chapter Segmentation)
  const chapters = [];
  let currentChapterEvents = [];
  let chapterIndex = 1;

  const flushChapter = (suggestedTitle = '') => {
    if (currentChapterEvents.length === 0) return;
    const startFloor = currentChapterEvents[0].messageId;
    const endFloor = currentChapterEvents[currentChapterEvents.length - 1].messageId;
    const title = suggestedTitle || `第 ${chapterIndex} 幕 · 剧情推进 (第 ${startFloor} - ${endFloor} 轮)`;

    chapters.push({
      id: `chapter-${chapterIndex}`,
      title,
      startFloor,
      endFloor,
      events: [...currentChapterEvents],
    });
    chapterIndex++;
    currentChapterEvents = [];
  };

  events.forEach((evt, idx) => {
    currentChapterEvents.push(evt);

    // 判定是否划分新章节：
    // a. 带有明显的章节书签或标签
    const hasChapterTag = evt.tags.some(t => t.name.includes('章') || t.name.includes('幕') || t.name.includes('主线'));
    // b. 分歧抉择点
    const isMajorFork = evt.isForkPoint;
    // c. 连续 10 轮次自动切幕
    const isIntervalReached = currentChapterEvents.length >= 10;

    if (idx === events.length - 1) {
      flushChapter();
    } else if (hasChapterTag || evt.isBookmark) {
      flushChapter(`第 ${chapterIndex} 幕 · ${evt.tags[0]?.name || '重要转折'}`);
    } else if (isMajorFork) {
      flushChapter(`第 ${chapterIndex} 幕 · 关键分歧抉择 (第 ${evt.messageId} 楼)`);
    } else if (isIntervalReached) {
      flushChapter();
    }
  });

  return {
    characterName,
    chatName,
    chapters,
    stats: {
      totalEvents: events.length,
      totalChapters: chapters.length,
      totalForks,
      userTurns,
      charTurns,
      approxWords,
    },
  };
}

/**
 * 将故事大纲数据格式化为标准的 GitHub Flavored Markdown 文档
 *
 * @param {StoryOutlineData} outlineData
 * @returns {string}
 */
export function formatStoryOutlineMarkdown(outlineData) {
  if (!outlineData) return '# 故事大纲\n\n暂无大纲数据。';

  const {
    characterName = 'SillyTavern',
    chatName = '剧情主线',
    chapters = [],
    stats = {},
  } = outlineData;

  const nowStr = new Date().toLocaleString();

  let md = `# 📜 《${characterName}》因果时间线 · 全景故事大纲\n\n`;
  md += `> **故事所属会话**：\`${chatName}\`  \n`;
  md += `> **生成时间**：${nowStr}  \n`;
  md += `> **宏观统计**：共 ${stats.totalChapters || 0} 幕 · ${stats.totalEvents || 0} 轮对话 · ${stats.totalForks || 0} 处分歧转折点 · 约 ${stats.approxWords || 0} 字\n\n`;

  md += `## 📑 故事章节目录\n\n`;
  chapters.forEach((chap, idx) => {
    md += `${idx + 1}. [${chap.title}](#${chap.id}) (第 ${chap.startFloor} - ${chap.endFloor} 轮)\n`;
  });
  md += `\n---\n\n`;

  md += `## 🎬 章节详述与剧情时间轴\n\n`;

  chapters.forEach(chap => {
    md += `### <a id="${chap.id}"></a>${chap.title}\n\n`;

    chap.events.forEach(evt => {
      const rolePrefix = evt.isUser ? '👤 **用户**' : `🎭 **${evt.senderName}**`;
      const floorTag = `\`#${evt.messageId}\``;
      const tagStr = evt.tags.length > 0 ? ` ${evt.tags.map(t => `🏷️\`${t.name}\``).join(' ')}` : '';
      const bookmarkStr = evt.isBookmark ? ' 🔖[书签检查点]' : '';
      const swipeStr = evt.swipeInfo ? ` 🔀(${evt.swipeInfo})` : '';

      md += `- ${floorTag} ${rolePrefix}${bookmarkStr}${swipeStr}${tagStr}：\n`;
      md += `  > ${evt.textSnippet}\n\n`;

      if (evt.isForkPoint) {
        md += `  > [!NOTE]\n  > ⚡ **剧情分歧点**：从此处演化出多条后续因果分支走向。\n\n`;
      }
    });

    md += `\n`;
  });

  md += `---\n\n`;
  md += `## 📊 剧情统计看板\n\n`;
  md += `| 统计指标 | 统计数值 |\n`;
  md += `| :--- | :--- |\n`;
  md += `| 故事角色 | ${characterName} |\n`;
  md += `| 用户交互轮次 | ${stats.userTurns || 0} 轮 |\n`;
  md += `| 角色回应轮次 | ${stats.charTurns || 0} 轮 |\n`;
  md += `| 剧情总轮次 | ${stats.totalEvents || 0} 轮 |\n`;
  md += `| 剧情分歧抉择点 | ${stats.totalForks || 0} 处 |\n`;
  md += `| 预估总字数 | 约 ${stats.approxWords || 0} 字 |\n\n`;
  md += `*由 SillyTavern Timelines 智能叙事引擎自动生成*\n`;

  return md;
}

/**
 * 触发浏览器原生下载 Markdown 文本文件
 *
 * @param {string} markdownText - Markdown 文本
 * @param {string} filename - 文件名
 */
export function downloadMarkdownFile(markdownText, filename = 'Story_Outline.md') {
  const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
