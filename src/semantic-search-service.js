/**
 * SillyTavern Timelines - Semantic Search Service
 * 语义检索纯算法 + Trivium 混合检索执行器
 *
 * 职责：
 * 1. 纯函数：hits（Trivium 检索结果）到当前内存图谱节点的映射、跨会话结果格式化。
 * 2. IO 薄层：semanticSearch —— 查询文本向量化后调用 trivium.searchHybrid。
 *
 * 设计约束：本模块必须可在 Node 测试环境独立导入运行；client/provider 均为注入参数。
 */

import { decodeExternalId } from './semantic-index-service.js';
import { hashText } from './embedding-provider.js';

/** 语义检索默认召回数 */
export const SEMANTIC_TOP_K = 30;

/** 向量与 BM25 文本通道的混合权重（0.5 = 均衡） */
export const SEMANTIC_HYBRID_ALPHA = 0.5;

/**
 * 将 Trivium hits 映射回当前内存图谱节点（纯函数）。
 *
 * 映射依据：hit.externalId（`<chatFile>::<messageId>`）对应节点 `chat_sessions` 中
 * 的 (chatFile, messageId) 组合；映射不上的 hit 属于"未打开的其他分支会话"。
 *
 * @param {Array<{externalId: string, score: number, payload: object}>} hits
 * @param {Array<object>} graphElements - Cytoscape 元素（节点 data 含 chat_sessions）或 cy 节点集合。
 * @returns {{matched: Array<{node: object, hit: object}>, unmatched: Array<object>}}
 */
export function mapHitsToNodes(hits, graphElements) {
  const source = Array.isArray(hits) ? hits : [];
  const elements = Array.isArray(graphElements) ? graphElements : [];

  // 构建 (chatFile::messageId) -> 节点对象 的倒排索引
  const nodeIndex = new Map();
  for (const el of elements) {
    const data = typeof el?.data === 'function' ? el.data() : (el?.data ?? el);
    if (!data || data.source || data.target) continue;
    if (data.isCluster || data.isLodCluster) continue;
    const sessions = data.chat_sessions;
    if (!sessions || typeof sessions !== 'object') continue;
    for (const [chatFile, session] of Object.entries(sessions)) {
      const messageId = session?.messageId ?? data.messageId ?? data.chat_depth;
      if (messageId == null) continue;
      const key = `${String(chatFile).replace(/\.jsonl$/i, '')}::${messageId}`;
      if (!nodeIndex.has(key)) {
        nodeIndex.set(key, el);
      }
    }
  }

  const matched = [];
  const unmatched = [];
  const seenNodes = new Set();

  for (const hit of source) {
    const decoded = decodeExternalId(hit?.externalId);
    const node = decoded ? nodeIndex.get(`${decoded.chatFile}::${decoded.messageId}`) : null;
    if (node) {
      const nodeId = typeof node?.id === 'function' ? node.id() : node?.data?.id;
      if (nodeId != null && seenNodes.has(nodeId)) continue; // 同一节点多楼层命中只保留最高分
      if (nodeId != null) seenNodes.add(nodeId);
      matched.push({ node, hit });
    } else {
      unmatched.push(hit);
    }
  }

  return { matched, unmatched };
}

/**
 * 格式化跨会话全局结果行（纯函数）。
 *
 * @param {Array<{externalId: string, score: number, payload: object}>} hits
 * @returns {Array<{chatFile: string, messageId: number, name: string, is_user: boolean, preview: string, score: number, tags: Array<string>, bookmark: boolean}>}
 */
export function formatGlobalResults(hits) {
  const source = Array.isArray(hits) ? hits : [];
  const rows = [];

  for (const hit of source) {
    const decoded = decodeExternalId(hit?.externalId);
    if (!decoded) continue;
    const payload = hit?.payload ?? {};
    rows.push({
      chatFile: decoded.chatFile,
      messageId: Number(decoded.messageId) || 0,
      name: String(payload.name ?? ''),
      is_user: Boolean(payload.is_user),
      preview: String(payload.preview ?? ''),
      score: Number(hit?.score ?? 0),
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      bookmark: Boolean(payload.bookmark),
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/**
 * 构建查询文本缓存键（查询向量化去重，短会话内重复查询零开销）。
 *
 * @param {string} queryText
 * @returns {string}
 */
export function makeQueryCacheKey(queryText) {
  return hashText(String(queryText ?? ''));
}

/**
 * 执行一次语义混合检索。
 *
 * @param {object} options
 * @param {object} options.client - Authority client。
 * @param {object} options.provider - embedding 提供方。
 * @param {string} [options.database] - Trivium 库名；缺省时按查询向量维度推导 `tl_vec_<dim>`（与索引端命名一致）。
 * @param {string} options.queryText - 查询文本。
 * @param {number} [options.topK=30]
 * @param {string} [options.namespace] - 作用域键（非空时附加 payloadFilter）。
 * @param {number} [options.hybridAlpha=0.5]
 * @returns {Promise<Array<{externalId: string, score: number, payload: object}>>} hits。
 */
export async function semanticSearch({
  client,
  provider,
  database = null,
  queryText,
  topK = SEMANTIC_TOP_K,
  namespace = null,
  hybridAlpha = SEMANTIC_HYBRID_ALPHA,
}) {
  if (!client || !provider || !queryText) {
    throw new Error('semanticSearch 缺少必要参数');
  }

  const [vector] = await provider.embed([String(queryText)]);
  if (!Array.isArray(vector)) {
    throw new Error('查询向量化失败');
  }

  const targetDatabase = database || `tl_vec_${vector.length}`;
  const payloadFilter = namespace ? { namespace: String(namespace) } : undefined;

  const hits = await client.trivium.searchHybrid({
    database: targetDatabase,
    vector,
    queryText: String(queryText),
    topK,
    hybridAlpha,
    payloadFilter,
  });

  return Array.isArray(hits) ? hits : [];
}
