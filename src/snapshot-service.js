/**
 * SillyTavern Timelines - Snapshot Service
 * 分支检查点快照与时光机存档管理服务
 * 
 * 职责：
 * 1. 扫描提取时间树中的书签、标签标注与用户命名快照点。
 * 2. 自动补充根节点、分叉决策点与分支末梢作为备选时光机锚点。
 * 3. 提供按关键字、标签、角色与分支的复合检索与排序。
 * 4. 导出为清晰美观的 Markdown 剧情存档清单。
 * 
 * 架构规范：
 * - 纯函数设计，不直接修改底层数据结构。
 * - 严格遵循原生 message.extra 与酒馆会话规范。
 */

import { extractNodeTags } from './tag-manager.js';
import { summarizeTextSnippet } from './story-outline-service.js';

/**
 * 从节点数据中提取主会话文件名
 * @param {object} nodeData
 * @returns {string}
 */
export function getPrimaryChatFile(nodeData) {
  if (!nodeData) return '';
  if (nodeData.chat_sessions && typeof nodeData.chat_sessions === 'object') {
    const keys = Object.keys(nodeData.chat_sessions);
    if (keys.length > 0) return keys[0];
  }
  if (typeof nodeData.chat_id === 'string') return nodeData.chat_id;
  if (typeof nodeData.chat === 'string') return nodeData.chat;
  return '';
}

/**
 * 提取时间树全量关键剧情快照点
 * @param {object} cy - Cytoscape 实例或节点列表
 * @param {object} [options]
 * @param {boolean} [options.includeBranchPoints=true] 是否自动包含剧情分流关键决策点
 * @returns {Array<object>} 排序后的快照点列表
 */
export function extractTimelineSnapshots(cy, options = {}) {
  const { includeBranchPoints = true } = options;
  if (!cy) return [];

  let rawNodes = [];
  if (typeof cy.nodes === 'function') {
    const cyNodes = cy.nodes();
    rawNodes = typeof cyNodes.toArray === 'function' ? cyNodes.toArray() : (Array.isArray(cyNodes) ? cyNodes : []);
  } else if (Array.isArray(cy)) {
    rawNodes = cy;
  } else if (cy && typeof cy.toArray === 'function') {
    rawNodes = cy.toArray();
  }

  const snapshots = [];

  for (const n of rawNodes) {
    if (!n) continue;
    let d = {};
    if (typeof n.data === 'function') {
      try {
        d = n.data() || {};
      } catch {
        d = {};
      }
    } else {
      d = n.data || n;
    }

    if (!d || d.isCluster || d.isLodCluster) continue;

    const nodeId = (typeof n.id === 'function' ? n.id() : n.id) || d.id || '';
    const messageId = d.depth != null ? Number(d.depth) : (d.floor != null ? Number(d.floor) : (d.messageId != null ? Number(d.messageId) : 0));
    const isBookmark = Boolean(d.isBookmark || d.bookmark || d.extra?.bookmark || d.swipeExtra?.bookmark);
    const customTitle = d.extra?.snapshotTitle || d.snapshotTitle || null;
    const tags = extractNodeTags(d);

    let inDegree = 0;
    let outDegree = 0;
    if (typeof n.ingoers === 'function' || typeof n.incomers === 'function') {
      inDegree = typeof n.incomers === 'function' ? n.incomers('edge').length : 0;
      outDegree = typeof n.outgoers === 'function' ? n.outgoers('edge').length : 0;
    } else if (d.inDegree != null || d.outDegree != null) {
      inDegree = Number(d.inDegree || 0);
      outDegree = Number(d.outDegree || 0);
    }

    const isRoot = inDegree === 0 && messageId === 0;
    const isBranchPoint = outDegree > 1;

    // 筛选规则：带有书签、标签、命名快照，或者是根节点、分支分叉点
    const isCandidate = isBookmark || (tags.length > 0) || customTitle || isRoot || (includeBranchPoints && isBranchPoint);

    if (!isCandidate) continue;

    const chatFile = getPrimaryChatFile(d);
    const speaker = d.name || (d.is_user ? 'User' : 'Character');
    const rawText = d.message || d.text || '';
    const previewText = summarizeTextSnippet(rawText, 100);

    let defaultTitle = '';
    if (customTitle) {
      defaultTitle = customTitle;
    } else if (isRoot) {
      defaultTitle = '🚀 故事起点 (Root Opening)';
    } else if (isBookmark) {
      defaultTitle = `⭐ 书签节点 · 楼层 #${messageId}`;
    } else if (tags.length > 0) {
      defaultTitle = `🏷️ 关键事件 · #${tags[0].name}`;
    } else if (isBranchPoint) {
      defaultTitle = `🔀 剧情分流抉择点 (${outDegree} 分支)`;
    } else {
      defaultTitle = `楼层 #${messageId} 快照`;
    }

    snapshots.push({
      id: nodeId,
      nodeId,
      chatFile,
      messageId,
      speaker,
      is_user: Boolean(d.is_user),
      title: defaultTitle,
      previewText,
      tags,
      isBookmark,
      isRoot,
      isBranchPoint,
      outDegree,
      timestamp: d.send_date || d.timestamp || null,
      rawNode: n,
    });
  }

  // 排序：先按楼层升序，同楼层按书签/命名优先级
  snapshots.sort((a, b) => {
    if (a.messageId !== b.messageId) {
      return a.messageId - b.messageId;
    }
    return (b.isBookmark ? 1 : 0) - (a.isBookmark ? 1 : 0);
  });

  return snapshots;
}

/**
 * 模糊检索快照列表
 * @param {Array<object>} snapshots
 * @param {string} query
 * @returns {Array<object>}
 */
export function filterSnapshots(snapshots, query) {
  if (!Array.isArray(snapshots)) return [];
  if (!query || typeof query !== 'string' || !query.trim()) {
    return snapshots;
  }
  const q = query.trim().toLowerCase();

  return snapshots.filter(s => {
    if (s.title && s.title.toLowerCase().includes(q)) return true;
    if (s.speaker && s.speaker.toLowerCase().includes(q)) return true;
    if (s.chatFile && s.chatFile.toLowerCase().includes(q)) return true;
    if (s.previewText && s.previewText.toLowerCase().includes(q)) return true;
    if (s.tags && s.tags.some(t => t.name.toLowerCase().includes(q))) return true;
    if (String(s.messageId).includes(q)) return true;
    return false;
  });
}

/**
 * 格式化快照列表为 GitHub Flavored Markdown
 * @param {Array<object>} snapshots
 * @param {object} [context]
 * @returns {string}
 */
export function formatSnapshotsMarkdown(snapshots, context = {}) {
  if (!snapshots || snapshots.length === 0) {
    return '# ⏳ 时光机快照归档\n\n当前时间树暂无快照或书签检查点。';
  }

  const charName = context.character || '角色扮演剧情';
  const listRows = snapshots.map((s, idx) => {
    const tagStr = s.tags.length > 0 ? s.tags.map(t => `\`#${t.name}\``).join(' ') : '—';
    const role = s.is_user ? 'User' : s.speaker;
    const file = s.chatFile ? `\`${s.chatFile}\`` : '当前分支';
    return `### ${idx + 1}. ${s.title}
- **楼层**：#${s.messageId} · **说话人**：${role}
- **所属分支**：${file}
- **标签**：${tagStr}
- **剧情台词摘要**：
  > ${s.previewText.replace(/\n/g, ' ')}
`;
  }).join('\n---\n\n');

  return `# ⏳ 时光机剧情快照与存档清单
> 角色：${charName} · 导出时间：${new Date().toLocaleString()} · 关键存档点：${snapshots.length} 个

---

${listRows}

---
*Generated by SillyTavern-Timelines Time Machine*
`;
}
