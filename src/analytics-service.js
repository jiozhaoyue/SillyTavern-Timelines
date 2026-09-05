/**
 * SillyTavern Timelines - Analytics Service
 * 剧情分支深度量化统计与全景数据分析模块
 * 
 * 职责：
 * 1. 提供纯函数拓扑指标计算（节点数、分支度、剧情终点、最大深度、分支决策点）。
 * 2. 对话发言天平量化（User 与 Character 轮次、字数规模、单次平均发言长度与占比）。
 * 3. 剧本探索度量化（Swipes 重试总数、最高重试深度、书签与里程碑覆盖度、标签词频排行）。
 * 4. 研报序列化输出（Markdown 研报与 JSON 数据交换格式）。
 * 
 * 架构规范：
 * - 纯计算模块，无 DOM / UI 耦合，无持久化数据库副作用。
 * - 兼容完整 Cytoscape 实例、纯数据对象数组与模拟节点集合。
 */

import { extractNodeTags } from './tag-manager.js';

/**
 * 统计中英文混合文本的字数与字符数
 * @param {string} text
 * @returns {{ words: number, chars: number }}
 */
export function countWordsAndChars(text) {
  if (!text || typeof text !== 'string') {
    return { words: 0, chars: 0 };
  }
  const str = text.trim();
  const chars = str.length;
  if (chars === 0) return { words: 0, chars: 0 };

  const enWords = (str.match(/[a-zA-Z0-9_'-]+/g) || []).length;
  const cjkChars = (str.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const words = (enWords + cjkChars) || chars;

  return { words, chars };
}

/**
 * 统一从 Cytoscape 节点或普通数据对象中提取属性
 * @param {object} node
 * @returns {object}
 */
export function extractNodeData(node) {
  if (!node) return {};
  if (typeof node.data === 'function') {
    try {
      const all = node.data();
      if (all && typeof all === 'object') return all;
    } catch {
      // fallback
    }
  }
  return node.data || node;
}

/**
 * 计算时间树全量指标
 * @param {object} cy - Cytoscape 实例或类似接口对象
 * @returns {object} 完整统计结果对象
 */
export function calculateTimelineStats(cy) {
  const defaultResult = {
    totalNodes: 0,
    rootNodes: 0,
    leafNodes: 0,
    branchPoints: 0,
    maxBranchingFactor: 0,
    avgBranchingFactor: 0,
    maxDepth: 0,
    avgDepth: 0,
    content: {
      totalWords: 0,
      totalChars: 0,
      avgWordsPerTurn: 0,
    },
    speakers: {
      user: { turns: 0, words: 0, chars: 0, avgWords: 0, turnPercent: 0, wordPercent: 0 },
      character: { turns: 0, words: 0, chars: 0, avgWords: 0, turnPercent: 0, wordPercent: 0 },
      system: { turns: 0, words: 0, chars: 0, avgWords: 0, turnPercent: 0, wordPercent: 0 },
    },
    swipes: {
      totalSwipes: 0,
      maxSwipesOnTurn: 0,
      turnsWithSwipes: 0,
      explorationRate: 0,
    },
    milestones: {
      bookmarks: 0,
      taggedNodes: 0,
      topTags: [],
    },
  };

  if (!cy) return defaultResult;

  let rawNodes = [];
  if (typeof cy.nodes === 'function') {
    const cyNodes = cy.nodes();
    rawNodes = typeof cyNodes.toArray === 'function' ? cyNodes.toArray() : (Array.isArray(cyNodes) ? cyNodes : []);
  } else if (Array.isArray(cy)) {
    rawNodes = cy;
  } else if (cy && typeof cy.toArray === 'function') {
    rawNodes = cy.toArray();
  }

  // 过滤有效剧情节点并排除 LOD 合并节点
  const validNodes = (Array.isArray(rawNodes) ? rawNodes : []).filter(n => {
    const d = extractNodeData(n);
    if (!d) return false;
    if (d.isCluster || d.isLodCluster) return false;
    return true;
  });

  if (validNodes.length === 0) {
    return defaultResult;
  }

  const totalNodes = validNodes.length;
  let rootNodes = 0;
  let leafNodes = 0;
  let branchPoints = 0;
  let maxBranching = 0;
  let totalBranchingChildren = 0;
  let maxDepth = 0;
  let sumDepth = 0;

  // 对白分布
  const speakerMap = {
    user: { turns: 0, words: 0, chars: 0 },
    character: { turns: 0, words: 0, chars: 0 },
    system: { turns: 0, words: 0, chars: 0 },
  };

  // Swipes 探索度
  let totalSwipes = 0;
  let maxSwipesOnTurn = 0;
  let turnsWithSwipes = 0;

  // 标签词频
  const tagCounter = new Map();
  let bookmarkCount = 0;
  let taggedNodeCount = 0;

  // 边拓扑统计
  for (const n of validNodes) {
    const d = extractNodeData(n);

    // 拓扑出入度计算
    let inDegree = 0;
    let outDegree = 0;
    if (typeof n.incomers === 'function') {
      inDegree = n.incomers('edge').length;
      outDegree = n.outgoers('edge').length;
    } else if (d.inDegree != null || d.outDegree != null) {
      inDegree = Number(d.inDegree || 0);
      outDegree = Number(d.outDegree || 0);
    }

    if (inDegree === 0) rootNodes++;
    if (outDegree === 0) leafNodes++;
    if (outDegree > 1) {
      branchPoints++;
      totalBranchingChildren += outDegree;
      if (outDegree > maxBranching) maxBranching = outDegree;
    }

    // 深度
    const depthVal = d.depth != null ? Number(d.depth) : (d.floor != null ? Number(d.floor) : 0);
    if (depthVal > maxDepth) maxDepth = depthVal;
    sumDepth += depthVal;

    // 文本与角色分析
    const rawText = d.message || d.text || '';
    const { words, chars } = countWordsAndChars(rawText);

    let role = 'character';
    if (d.is_user) {
      role = 'user';
    } else if (d.is_system || d.role === 'system') {
      role = 'system';
    }

    speakerMap[role].turns++;
    speakerMap[role].words += words;
    speakerMap[role].chars += chars;

    // Swipes 分析
    let swipeCount = 0;
    if (Array.isArray(d.swipes)) {
      swipeCount = d.swipes.length;
    } else if (d.swipe_id != null && Number(d.swipe_id) >= 0) {
      swipeCount = Number(d.swipe_id) + 1;
    }
    if (swipeCount > 1) {
      turnsWithSwipes++;
    }
    totalSwipes += (swipeCount > 0 ? swipeCount : 1);
    if (swipeCount > maxSwipesOnTurn) {
      maxSwipesOnTurn = swipeCount;
    }

    // 标签与书签分析
    const rawTags = extractNodeTags(d);
    if (rawTags.length > 0) {
      taggedNodeCount++;
      for (const t of rawTags) {
        const tagName = typeof t === 'string' ? t : (t.name || String(t));
        tagCounter.set(tagName, (tagCounter.get(tagName) || 0) + 1);
      }
    }
    if (d.isBookmark || d.bookmark || d.extra?.bookmark) {
      bookmarkCount++;
    }
  }

  // 汇总总内容字数
  const totalWords = speakerMap.user.words + speakerMap.character.words + speakerMap.system.words;
  const totalChars = speakerMap.user.chars + speakerMap.character.chars + speakerMap.system.chars;

  const buildSpeakerResult = (data) => ({
    turns: data.turns,
    words: data.words,
    chars: data.chars,
    avgWords: data.turns > 0 ? Math.round(data.words / data.turns) : 0,
    turnPercent: totalNodes > 0 ? Number(((data.turns / totalNodes) * 100).toFixed(1)) : 0,
    wordPercent: totalWords > 0 ? Number(((data.words / totalWords) * 100).toFixed(1)) : 0,
  });

  // 排序高频标签 Top 15
  const topTags = Array.from(tagCounter.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const avgBranchingFactor = branchPoints > 0
    ? Number((totalBranchingChildren / branchPoints).toFixed(2))
    : 0;

  return {
    totalNodes,
    rootNodes,
    leafNodes: leafNodes || 1,
    branchPoints,
    maxBranchingFactor: maxBranching,
    avgBranchingFactor,
    maxDepth,
    avgDepth: totalNodes > 0 ? Number((sumDepth / totalNodes).toFixed(1)) : 0,
    content: {
      totalWords,
      totalChars,
      avgWordsPerTurn: totalNodes > 0 ? Math.round(totalWords / totalNodes) : 0,
    },
    speakers: {
      user: buildSpeakerResult(speakerMap.user),
      character: buildSpeakerResult(speakerMap.character),
      system: buildSpeakerResult(speakerMap.system),
    },
    swipes: {
      totalSwipes,
      maxSwipesOnTurn,
      turnsWithSwipes,
      explorationRate: totalNodes > 0 ? Number(((turnsWithSwipes / totalNodes) * 100).toFixed(1)) : 0,
    },
    milestones: {
      bookmarks: bookmarkCount,
      taggedNodes: taggedNodeCount,
      topTags,
    },
  };
}

/**
 * 格式化为 GitHub Flavored Markdown 深度分析研报
 * @param {object} stats
 * @returns {string} Markdown 文本
 */
export function formatAnalyticsMarkdown(stats) {
  if (!stats) return '# 时间线统计报告\n\n暂无数据。';

  const {
    totalNodes,
    rootNodes,
    leafNodes,
    branchPoints,
    maxBranchingFactor,
    avgBranchingFactor,
    maxDepth,
    avgDepth,
    content,
    speakers,
    swipes,
    milestones,
  } = stats;

  const tagList = milestones.topTags.length > 0
    ? milestones.topTags.map(t => `\`#${t.tag}\` (${t.count})`).join(' · ')
    : '暂无高频标签';

  return `# 📜 剧情时间树量化分析与全景研报
> 导出时间：${new Date().toLocaleString()} · 剧情树全景画像

---

## 📊 一、核心拓扑规模与分支复杂度
| 指标名称 | 数值 | 说明 |
| :--- | :--- | :--- |
| **总剧情节点数** | **${totalNodes}** | 包含所有分支上的消息轮次 |
| **剧情结局/叶分支数** | **${leafNodes}** | 当前已探索到的不同分支末端结局 |
| **分支分叉决策点** | **${branchPoints}** | 发生剧情分流的关键节点数 |
| **最大单点分支数** | **${maxBranchingFactor}** | 单个节点分流出的最多子剧情路径 |
| **平均分叉度** | **${avgBranchingFactor}** | 分叉节点的平均子分支数 |
| **最大剧情深度** | **${maxDepth} 轮** | 从根节点至最远叶节点的深度 |
| **平均剧情轮次** | **${avgDepth} 轮** | 剧情树中节点的平均所处楼层 |

---

## 🎭 二、对话天平与角色发言分布
| 说话人角色 | 发言轮次 | 轮次占比 | 总字数规模 | 字数占比 | 单条平均字数 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **User (玩家)** | ${speakers.user.turns} | ${speakers.user.turnPercent}% | ${speakers.user.words} 字 | ${speakers.user.wordPercent}% | ${speakers.user.avgWords} 字/条 |
| **Character (角色)** | ${speakers.character.turns} | ${speakers.character.turnPercent}% | ${speakers.character.words} 字 | ${speakers.character.wordPercent}% | ${speakers.character.avgWords} 字/条 |
| **System (系统提示)** | ${speakers.system.turns} | ${speakers.system.turnPercent}% | ${speakers.system.words} 字 | ${speakers.system.wordPercent}% | ${speakers.system.avgWords} 字/条 |
| **总计** | **${totalNodes}** | 100% | **${content.totalWords} 字** | 100% | **${content.avgWordsPerTurn} 字/条** |

---

## 🎲 三、Swipes 探索深度与重试偏好
- **累计产生 Swipes 样本总数**：${swipes.totalSwipes} 次
- **单轮最高重试探索深度**：${swipes.maxSwipesOnTurn} 次
- **具有分支重试的对话轮次**：${swipes.turnsWithSwipes} 轮
- **剧本重试探索率**：${swipes.explorationRate}%

---

## 🏷️ 四、剧情里程碑与高频标签
- **书签标记关键节点**：${milestones.bookmarks} 处
- **自定义标注节点总数**：${milestones.taggedNodes} 处
- **高频剧情标签分布**：
  ${tagList}

---
*Generated by SillyTavern-Timelines Analytics Suite*
`;
}

/**
 * 格式化为标准 JSON 字符串
 * @param {object} stats
 * @returns {string} JSON 文本
 */
export function formatAnalyticsJson(stats) {
  return JSON.stringify(stats || {}, null, 2);
}
