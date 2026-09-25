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

/** 语义检索默认召回数 */
export const SEMANTIC_TOP_K = 30;

/** 向量与 BM25 文本通道的混合权重（0.5 = 均衡） */
export const SEMANTIC_HYBRID_ALPHA = 0.5;

/** 客户端后过滤生效时 topK 的召回放大倍数（payloadFilter 不支持数组/组合语义，靠多召回补偿） */
export const SEMANTIC_POSTFILTER_TOPK_BOOST = 3;

/** neighbors 上下文扩展的命中数上限与图深度（L1-MF-11：控制服务端查询面） */
export const SEMANTIC_NEIGHBORS_TOP_N = 5;
export const SEMANTIC_NEIGHBORS_DEPTH = 1;

/**
 * 构建服务端 payloadFilter（纯函数）。
 *
 * 2026-09-25 实机实测结论：Trivium payloadFilter 仅支持标量等值（namespace / bookmark 均可），
 * 数组字段（tags）任何形态（['x'] / 'x' / {$in}）都不匹配，{$has} 直接报不支持。
 * 因此标签类筛选走客户端后过滤（filterHitsByPayload），不入此 filter。
 *
 * @param {object} [options]
 * @param {string|null} [options.namespace] - 作用域键；null 时不加（跨角色全局检索）。
 * @param {boolean} [options.bookmark] - true 时过滤书签节点。
 * @returns {object|undefined} payloadFilter；无任何条件时返回 undefined。
 */
export function buildSemanticPayloadFilter({ namespace = null, bookmark = false } = {}) {
  const filter = {};
  if (namespace != null && String(namespace).trim()) filter.namespace = String(namespace);
  if (bookmark) filter.bookmark = true;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * 客户端后过滤（纯函数）：对 hits 的 payload 做 payloadFilter 不支持的维度筛选。
 *
 * @param {Array<{externalId: string, score: number, payload: object}>} hits
 * @param {object} [options]
 * @param {boolean} [options.onlyTagged] - 仅保留带彩色标签的命中。
 * @param {string} [options.speakerFilter] - 'all' | 'user' | 'character'。
 * @returns {Array} 过滤后的 hits（输入数组不被修改）。
 */
export function filterHitsByPayload(hits, { onlyTagged = false, speakerFilter = 'all' } = {}) {
  const source = Array.isArray(hits) ? hits : [];
  if (!onlyTagged && speakerFilter === 'all') return source;
  return source.filter(hit => {
    const payload = hit?.payload ?? {};
    if (onlyTagged && !(Array.isArray(payload.tags) && payload.tags.length > 0)) return false;
    if (speakerFilter === 'user' && !payload.is_user) return false;
    if (speakerFilter === 'character' && payload.is_user) return false;
    return true;
  });
}

/**
 * 按来源 namespace 分组全局结果（纯函数，保持分数序）。
 *
 * @param {Array<{namespace?: string, namespaceLabel?: string}>} rows - formatGlobalResults 输出。
 * @returns {Array<{key: string, label: string, rows: Array}>} 组列表；key 缺省归入 'unknown'。
 */
export function groupGlobalResultsByNamespace(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const groups = new Map();
  for (const row of source) {
    const key = String(row?.namespace ?? 'unknown');
    if (!groups.has(key)) {
      groups.set(key, { key, label: String(row?.namespaceLabel ?? '') || key, rows: [] });
    }
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}

/**
 * 为语义命中拉取楼层邻居（IO 薄层，A1 语义上下文）。
 *
 * 特性检测 + 静默降级：client.trivium.neighbors 不存在（旧版宿主）或调用失败时返回空 Map，
 * 绝不抛错、不波及检索主链路（L0-11）。
 *
 * @param {object} options
 * @param {object} options.client - Authority client。
 * @param {string} options.database - Trivium 库名。
 * @param {Array<{externalId: string, id?: number}>} hits - searchHybrid 命中（需带内部 id）。
 * @param {number} [options.topN=5] - 最多扩展的命中数。
 * @param {number} [options.depth=1] - 图遍历深度。
 * @returns {Promise<Map<string, Array<{externalId: string|null, chatFile: string, messageId: string}>>>}
 *   externalId → 邻居引用列表（已解码为楼层身份）。
 */
export async function fetchNeighborsForHits({ client, database, hits, topN = SEMANTIC_NEIGHBORS_TOP_N, depth = SEMANTIC_NEIGHBORS_DEPTH }) {
  const result = new Map();
  if (!database || !client || typeof client?.trivium?.neighbors !== 'function') return result; // 库名未定或方法不存在：静默降级
  const source = Array.isArray(hits) ? hits.filter(h => h?.id != null && h?.externalId).slice(0, Math.max(0, Number(topN) || 0)) : [];
  for (const hit of source) {
    try {
      const resp = await client.trivium.neighbors({ database, id: hit.id, depth });
      const refs = (resp?.nodes ?? [])
        .filter(n => n?.externalId)
        .map(n => {
          const decoded = decodeExternalId(n.externalId);
          return decoded
            ? { ...decoded, externalId: n.externalId }
            : { externalId: n.externalId, chatFile: n.externalId, messageId: '' };
        });
      result.set(hit.externalId, refs);
    } catch {
      /* 单个命中扩展失败不影响其余结果 */
    }
  }
  return result;
}

/**
 * 组装命中与邻居上下文（纯函数，供 UI 折叠段渲染）。
 *
 * @param {Array<{externalId: string}>} rows - formatGlobalResults 输出行（含 externalId 前身）。
 * @param {Map<string, Array<{chatFile: string, messageId: string}>>} neighborsByExternalId
 * @returns {Array<{row: object, context: Array<{chatFile: string, messageId: string}>}>}
 */
export function expandHitWithContexts(rows, neighborsByExternalId) {
  const source = Array.isArray(rows) ? rows : [];
  const map = neighborsByExternalId instanceof Map ? neighborsByExternalId : new Map();
  return source.map(row => ({
    row,
    context: map.get(row?.externalId) ?? [],
  }));
}

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
      externalId: hit?.externalId ?? null,
      name: String(payload.name ?? ''),
      is_user: Boolean(payload.is_user),
      preview: String(payload.preview ?? ''),
      score: Number(hit?.score ?? 0),
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      bookmark: Boolean(payload.bookmark),
      namespace: payload.namespace != null ? String(payload.namespace) : null,
      namespaceLabel: payload.namespaceLabel != null ? String(payload.namespaceLabel) : null,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows;
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
 * @param {string} [options.namespace] - 作用域键（scope='character' 且非空时进入服务端 payloadFilter）。
 * @param {number} [options.hybridAlpha=0.5]
 * @param {boolean} [options.bookmark=false] - 服务端书签过滤（payload 等值）。
 * @param {'character'|'global'} [options.scope='character'] - 检索范围；global 时不加 namespace 过滤（跨角色）。
 * @param {object|null} [options.postFilter=null] - 客户端后过滤（filterHitsByPayload 参数；生效时 topK 自动放大保召回）。
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
  bookmark = false,
  scope = 'character',
  postFilter = null,
}) {
  if (!client || !provider || !queryText) {
    throw new Error('semanticSearch 缺少必要参数');
  }

  const [vector] = await provider.embed([String(queryText)]);
  if (!Array.isArray(vector)) {
    throw new Error('查询向量化失败');
  }

  const targetDatabase = database || `tl_vec_${vector.length}`;
  const effectiveNamespace = scope === 'global' ? null : namespace;
  const payloadFilter = buildSemanticPayloadFilter({ namespace: effectiveNamespace, bookmark });

  let hits = await client.trivium.searchHybrid({
    database: targetDatabase,
    vector,
    queryText: String(queryText),
    topK: postFilter ? topK * SEMANTIC_POSTFILTER_TOPK_BOOST : topK,
    hybridAlpha,
    payloadFilter,
  });
  hits = Array.isArray(hits) ? hits : [];

  if (postFilter) {
    hits = filterHitsByPayload(hits, postFilter);
  }

  return hits;
}
