/**
 * SillyTavern Timelines - Semantic Index Service
 * Authority 语义索引服务（Trivium 向量图数据库写入与增量维护）
 *
 * 职责：
 * 1. 纯算法：externalId 编解码、节点 payload 构建、内容指纹、增量 diff、楼层链接合成。
 * 2. IO 编排：SemanticIndexer —— 枚举图谱 → diff → 批量向量化 → Trivium 写入 → SQL 状态表维护。
 * 3. 编排入口：runSemanticIndexBuild / getSemanticIndexStatus（供 index.js 设置面板与雷达调用）。
 *
 * 哲学约束：原生 message.extra 仍是唯一数据源；本服务在 Authority 中的全部数据
 * （向量索引 + index_state 状态表）均为可随时全量重建的派生投影，删除即重建，零原生污染。
 */

import { hashText, chunkTexts, createEmbeddingProvider } from './embedding-provider.js';
import { extractNodeTags } from './tag-manager.js';
import { getAuthorityClient, getAuthorityStatus } from './adapters/authority-adapter.js';

/** 每批写入 Trivium 的节点数 */
const UPSERT_BATCH_SIZE = 50;
/** 每批建立图边数 */
const LINK_BATCH_SIZE = 100;
/** 节点文本预览长度 */
const PREVIEW_LENGTH = 200;

/**
 * 编码 Trivium externalId：`<chatFile 去扩展名>::<messageId>`。
 *
 * @param {string} chatFile - 会话文件名（可带 .jsonl 后缀）。
 * @param {number|string} messageId - 楼层号。
 * @returns {string} 稳定 externalId。
 */
export function encodeExternalId(chatFile, messageId) {
  const file = String(chatFile ?? '').replace(/\.jsonl$/i, '');
  return `${file}::${messageId}`;
}

/**
 * 解码 Trivium externalId。
 *
 * @param {string} externalId
 * @returns {{chatFile: string, messageId: string}|null} 解码失败返回 null。
 */
export function decodeExternalId(externalId) {
  const str = String(externalId ?? '');
  const sep = str.lastIndexOf('::');
  if (sep <= 0 || sep === str.length - 2) return null;
  return {
    chatFile: str.slice(0, sep),
    messageId: str.slice(sep + 2),
  };
}

/**
 * 规范化节点文本（图谱节点以 msg 为主，兼容 message/text 字段）。
 *
 * 注意：真实图谱节点（graph-builder createNode 输出）的文本字段是 `msg`，
 * message/text 仅作为旧数据或调用方自定义形状的兜底。
 *
 * @param {object} nodeData
 * @returns {string}
 */
function getNodeText(nodeData) {
  return String(nodeData?.message ?? nodeData?.msg ?? nodeData?.text ?? '');
}

/**
 * 为索引条目解析全文（省内存模式下节点 msg 为截断预览）。
 *
 * 在指纹 diff 与向量化之前调用，保证内容哈希与向量质量不受设备画像影响；
 * 同一节点的多会话条目共享一次解析。解析失败保持预览，不阻断构建。
 *
 * @param {Array<{chatFile: string, messageId: number, nodeData: object, externalId: string}>} entries
 * @param {Function|null} resolveFullText - async (nodeData) => string|null。
 * @returns {Promise<Array>} 新条目数组（原始数组不被修改）。
 */
export async function resolveEntryFullTexts(entries, resolveFullText) {
  const source = Array.isArray(entries) ? entries : [];
  if (typeof resolveFullText !== 'function') return source;

  const resolvedCache = new Map(); // nodeData.id -> 解析后的 nodeData
  const output = [];

  for (const entry of source) {
    const nodeData = entry?.nodeData;
    if (!nodeData?.msgTruncated) {
      output.push(entry);
      continue;
    }
    const cacheKey = nodeData.id ?? entry.externalId;
    if (!resolvedCache.has(cacheKey)) {
      let next = nodeData;
      try {
        const full = await resolveFullText(nodeData);
        if (typeof full === 'string' && full) {
          next = { ...nodeData, msg: full };
        }
      } catch {
        /* 解析失败保持预览 */
      }
      resolvedCache.set(cacheKey, next);
    }
    output.push({ ...entry, nodeData: resolvedCache.get(cacheKey) });
  }

  return output;
}

/**
 * 从图谱节点数据构建 Trivium payload（纯函数）。
 *
 * @param {object} nodeData - 图谱节点数据（含 chat_sessions）。
 * @param {string} chatFile - 会话文件名。
 * @param {number|string} messageId - 楼层号。
 * @returns {object} 精简 payload（含 namespace 留空，由调用方补充）。
 */
export function buildNodePayload(nodeData, chatFile, messageId) {
  const text = getNodeText(nodeData);
  const tags = extractNodeTags(nodeData) || [];
  const bookmark = Boolean(
    nodeData?.isBookmark || nodeData?.bookmark || nodeData?.extra?.bookmark || nodeData?.swipeExtra?.bookmark,
  );
  return {
    chatFile: String(chatFile ?? '').replace(/\.jsonl$/i, ''),
    messageId: Number(messageId) || 0,
    name: String(nodeData?.name ?? ''),
    is_user: Boolean(nodeData?.is_user),
    depth: nodeData?.depth != null ? Number(nodeData.depth) : null,
    tags: tags.map(t => String(t?.name ?? t ?? '')).filter(Boolean),
    bookmark,
    preview: text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}...` : text,
  };
}

/**
 * 计算节点的稳定内容指纹（文本 + 元数据任一变化即视为待重索引）。
 *
 * @param {object} nodeData - 图谱节点数据。
 * @param {string} chatFile
 * @param {number|string} messageId
 * @returns {string} 哈希字符串。
 */
export function computeContentHash(nodeData, chatFile, messageId) {
  const payload = buildNodePayload(nodeData, chatFile, messageId);
  return hashText(JSON.stringify(payload));
}

/**
 * 从图谱元素中枚举全部 (会话, 楼层) 索引条目（纯函数）。
 *
 * 枚举源说明：跨会话去重树的每个节点都带 `chat_sessions` 映射
 * （chatFile -> {messageId,...}），天然覆盖所有分支会话，无需单独扫文件。
 *
 * @param {Array<object>} elements - Cytoscape 元素数组（节点与边）。
 * @returns {Array<{chatFile: string, messageId: number, nodeData: object, externalId: string}>}
 */
export function enumerateIndexEntries(elements) {
  const list = Array.isArray(elements) ? elements : [];
  const entries = [];
  const seen = new Set();

  for (const el of list) {
    const data = el?.data ?? el;
    if (!data || data.source || data.target) continue; // 跳过边
    if (data.isCluster || data.isLodCluster) continue; // 跳过聚合节点
    const sessions = data.chat_sessions;
    if (!sessions || typeof sessions !== 'object') continue;

    for (const [chatFile, session] of Object.entries(sessions)) {
      const messageId = Number(session?.messageId ?? data.messageId ?? data.chat_depth ?? NaN);
      if (!Number.isFinite(messageId)) continue;
      const externalId = encodeExternalId(chatFile, messageId);
      if (seen.has(externalId)) continue; // 同一会话同一楼层只保留一份
      seen.add(externalId);
      entries.push({ chatFile, messageId, nodeData: data, externalId });
    }
  }

  entries.sort((a, b) => a.externalId.localeCompare(b.externalId));
  return entries;
}

/**
 * 增量 diff：对比当前条目与已索引状态表（纯函数，增量算法核心）。
 *
 * @param {Array<{chatFile: string, messageId: number, externalId: string, nodeData: object}>} entries
 * @param {Array<{chat_file: string, message_id: number, content_hash: string, trivium_db: string}>} stateRows
 * @param {string} targetDb - 本次构建的 Trivium 库名。
 * @returns {{upserts: Array<object>, deletes: Array<string>, unchangedCount: number, staleOtherDb: Array<string>}}
 *   upserts: 新增或内容变化或位于其他库的条目；deletes: 已消失条目的 externalId（限 targetDb）；
 *   staleOtherDb: 状态表中位于其他库的条目（不自动删除，交由上层决策）。
 */
export function diffIndexState(entries, stateRows, targetDb) {
  const source = Array.isArray(entries) ? entries : [];
  const rows = Array.isArray(stateRows) ? stateRows : [];

  const stateMap = new Map();
  for (const row of rows) {
    stateMap.set(encodeExternalId(row.chat_file, row.message_id), row);
  }

  const upserts = [];
  const entryKeys = new Set();

  for (const entry of source) {
    entryKeys.add(entry.externalId);
    const row = stateMap.get(entry.externalId);
    const hash = computeContentHash(entry.nodeData, entry.chatFile, entry.messageId);
    const needsWrite =
      !row || row.content_hash !== hash || String(row.trivium_db ?? '') !== String(targetDb);
    if (needsWrite) {
      upserts.push({ ...entry, contentHash: hash });
    }
  }

  const deletes = [];
  const staleOtherDb = [];
  for (const [externalId, row] of stateMap.entries()) {
    if (!entryKeys.has(externalId)) {
      // 条目已消失：只清理与目标库一致的行；其他库的行交由上层提示
      if (String(row.trivium_db ?? '') === String(targetDb)) {
        deletes.push(externalId);
      } else {
        staleOtherDb.push(externalId);
      }
    } else if (String(row.trivium_db ?? '') !== String(targetDb)) {
      // 仍存在但被判定需写入新库：旧库中的旧版本需要删除
      staleOtherDb.push(externalId);
    }
  }

  return {
    upserts,
    deletes,
    staleOtherDb,
    unchangedCount: source.length - upserts.length,
  };
}

/**
 * 依会话内楼层顺序合成相邻链接（纯函数）：同一 chatFile 内 messageId 相邻节点建 `next` 边。
 *
 * @param {Array<{chatFile: string, messageId: number, externalId: string}>} entries
 * @returns {Array<{src: {externalId: string}, dst: {externalId: string}, label: string, weight: number}>}
 */
export function buildFloorLinks(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const byChat = new Map();

  for (const entry of source) {
    if (!byChat.has(entry.chatFile)) {
      byChat.set(entry.chatFile, []);
    }
    byChat.get(entry.chatFile).push(entry);
  }

  const links = [];
  for (const [, list] of byChat.entries()) {
    list.sort((a, b) => (Number(a.messageId) || 0) - (Number(b.messageId) || 0));
    for (let i = 1; i < list.length; i++) {
      links.push({
        src: { externalId: list[i - 1].externalId },
        dst: { externalId: list[i].externalId },
        label: 'next',
        weight: 1,
      });
    }
  }
  return links;
}

/** index_state 表结构（幂等迁移语句） */
const INDEX_STATE_MIGRATIONS = [
  {
    id: '001_create_index_state',
    statement: `CREATE TABLE IF NOT EXISTS index_state (
      namespace TEXT NOT NULL,
      chat_file TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      trivium_db TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      PRIMARY KEY (namespace, chat_file, message_id)
    )`,
  },
];

/**
 * 语义索引器：枚举 → diff → 向量化 → Trivium 写入 → 状态表维护（IO 编排）。
 */
export class SemanticIndexer {
  /**
   * @param {object} options
   * @param {object} options.client - Authority client（trivium.* / sql.* 可用）。
   * @param {object} options.provider - embedding 提供方（createEmbeddingProvider 实例）。
   * @param {string} options.namespace - 索引命名空间（角色/群组作用域键）。
   * @param {Function} [options.onProgress] - ({phase, done, total, message}) => void。
   * @param {Function} [options.resolveFullText] - async (nodeData) => string|null，省内存模式下解析节点全文。
   */
  constructor({ client, provider, namespace, onProgress = null, resolveFullText = null }) {
    if (!client) throw new Error('SemanticIndexer 需要 Authority client');
    if (!provider) throw new Error('SemanticIndexer 需要 embedding provider');
    this.client = client;
    this.provider = provider;
    this.namespace = String(namespace ?? 'default');
    this.onProgress = typeof onProgress === 'function' ? onProgress : null;
    this.resolveFullText = typeof resolveFullText === 'function' ? resolveFullText : null;
    this._cancelled = false;
    this._running = false;
  }

  /** 请求中断（在批间生效） */
  cancel() {
    this._cancelled = true;
  }

  _emit(phase, done, total, message) {
    if (this.onProgress) {
      try {
        this.onProgress({ phase, done, total, message });
      } catch {
        /* 进度回调异常不中断构建 */
      }
    }
  }

  _ensureDatabase(dim) {
    // 向量维度进入库名：embedding 后端更换导致维度变化时天然切库，绝不混维度
    return `tl_vec_${dim}`;
  }

  /**
   * 执行一次（增量）索引构建。
   *
   * @param {object} options
   * @param {Array<object>} options.elements - 图谱元素（nodeData 含 chat_sessions）。
   * @param {boolean} [options.forceRebuild=false] - 忽略指纹，全量重写。
   * @returns {Promise<{database: string, upserted: number, deleted: number, unchanged: number, links: number}>}
   */
  async build({ elements, forceRebuild = false } = {}) {
    if (this._running) {
      throw new Error('索引构建已在进行中');
    }
    this._running = true;
    this._cancelled = false;

    try {
      let entries = enumerateIndexEntries(elements);
      if (entries.length === 0) {
        return { database: null, upserted: 0, deleted: 0, unchanged: 0, links: 0 };
      }
      entries = await resolveEntryFullTexts(entries, this.resolveFullText);

      // 1. 确保状态表存在并读取当前命名空间的索引状态
      await this.client.sql.migrate({ database: 'main', migrations: INDEX_STATE_MIGRATIONS });
      const stateResp = await this.client.sql.query({
        database: 'main',
        statement: 'SELECT chat_file, message_id, content_hash, trivium_db FROM index_state WHERE namespace = ?',
        params: [this.namespace],
      });
      const stateRows = stateResp?.rows ?? stateResp ?? [];

      // 2. 先探测向量维度以确定目标库（用首个条目文本试向量化）
      this._emit('embed', 0, entries.length, '探测向量维度');
      const probeText = getNodeText(entries[0].nodeData) || entries[0].externalId;
      const probeVector = (await this.provider.embed([probeText]))[0];
      const targetDb = this._ensureDatabase(probeVector.length);

      // 3. 增量 diff（强制重建仅覆盖写入范围，已消失条目的清理逻辑保持一致）
      const baseDiff = diffIndexState(entries, stateRows, targetDb);
      const diff = forceRebuild
        ? {
            upserts: entries.map(e => ({ ...e, contentHash: computeContentHash(e.nodeData, e.chatFile, e.messageId) })),
            deletes: baseDiff.deletes,
            staleOtherDb: baseDiff.staleOtherDb,
            unchangedCount: 0,
          }
        : baseDiff;

      // 4. 清理已消失条目（含切换库后的旧库残留，均在状态表登记过的范围内）
      const deletes = [...diff.deletes];
      if (diff.staleOtherDb.length > 0) {
        // 维度切库等场景：旧库中的同键旧版本一并删除（状态表记录了其所在库）
        const oldDbRows = stateRows.filter(r => {
          const key = encodeExternalId(r.chat_file, r.message_id);
          return diff.staleOtherDb.includes(key) && String(r.trivium_db ?? '') !== targetDb;
        });
        const oldDbNames = [...new Set(oldDbRows.map(r => String(r.trivium_db)))];
        for (const oldDb of oldDbNames) {
          if (this._cancelled) break;
          const items = oldDbRows
            .filter(r => String(r.trivium_db) === oldDb)
            .map(r => ({ externalId: encodeExternalId(r.chat_file, r.message_id) }));
          for (const chunk of chunkTexts(items, LINK_BATCH_SIZE)) {
            await this.client.trivium.bulkDelete({ database: oldDb, items: chunk });
          }
        }
      }
      if (deletes.length > 0) {
        for (const chunk of chunkTexts(deletes.map(externalId => ({ externalId })), LINK_BATCH_SIZE)) {
          if (this._cancelled) break;
          await this.client.trivium.bulkDelete({ database: targetDb, items: chunk });
        }
      }

      // 5. 向量化待写条目（全文本，非截断预览）
      const texts = diff.upserts.map(e => getNodeText(e.nodeData) || e.externalId);
      this._emit('embed', 0, diff.upserts.length, '生成向量');
      const vectors = await this.provider.embed(texts);

      // 6. 分批 bulkUpsert + indexText（BM25 文本通道）+ 状态表登记
      let upserted = 0;
      const upsertBatches = chunkTexts(diff.upserts, UPSERT_BATCH_SIZE);
      for (let b = 0; b < upsertBatches.length; b++) {
        if (this._cancelled) break;
        const batch = upsertBatches[b];
        const vectorBatch = vectors.slice(b * UPSERT_BATCH_SIZE, (b + 1) * UPSERT_BATCH_SIZE);

        const items = batch.map((entry, i) => ({
          externalId: entry.externalId,
          namespace: this.namespace,
          vector: vectorBatch[i],
          payload: { ...buildNodePayload(entry.nodeData, entry.chatFile, entry.messageId), namespace: this.namespace },
        }));
        const resp = await this.client.trivium.bulkUpsert({ database: targetDb, items });

        // 为 BM25 通道写入文本索引（需要内部数字 id，从 upsert 响应取）
        const idMap = new Map();
        for (const item of resp?.items ?? []) {
          if (item?.externalId && item?.id != null) idMap.set(item.externalId, item.id);
        }
        for (let i = 0; i < batch.length; i++) {
          const internalId = idMap.get(batch[i].externalId);
          if (internalId != null) {
            await this.client.trivium.indexText({
              database: targetDb,
              id: internalId,
              text: `${items[i].payload.name} ${texts[b * UPSERT_BATCH_SIZE + i]}`.trim(),
            });
          }
        }

        // 登记状态表
        const statements = batch.map((entry, i) => ({
          statement: 'INSERT OR REPLACE INTO index_state (namespace, chat_file, message_id, content_hash, trivium_db, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
          params: [
            this.namespace,
            String(entry.chatFile).replace(/\.jsonl$/i, ''),
            entry.messageId,
            entry.contentHash,
            targetDb,
            new Date().toISOString(),
          ],
        }));
        try {
          await this.client.sql.batch({ database: 'main', statements });
        } catch {
          // batch 不可用时逐条兜底
          for (const s of statements) {
            await this.client.sql.exec({ database: 'main', statement: s.statement, params: s.params });
          }
        }

        upserted += batch.length;
        this._emit('upsert', upserted, diff.upserts.length, `已写入 ${upserted}/${diff.upserts.length} 个节点`);
      }

      // 7. 楼层链接（全量重建边：bulkLink 幂等代价低，量级 ≈ 节点数）
      let linkCount = 0;
      if (!this._cancelled && diff.upserts.length > 0) {
        const links = buildFloorLinks(entries);
        for (const chunk of chunkTexts(links, LINK_BATCH_SIZE)) {
          if (this._cancelled) break;
          await this.client.trivium.bulkLink({ database: targetDb, items: chunk });
          linkCount += chunk.length;
        }
        this._emit('link', linkCount, links.length, '建立楼层链接');
      }

      // 8. 属性索引（payload 过滤加速；失败仅告警）
      for (const field of ['namespace', 'chatFile']) {
        try {
          await this.client.trivium.createIndex({ database: targetDb, field });
        } catch {
          /* 索引可能已存在 */
        }
      }

      // 9. 刷盘（尽力而为）
      try {
        await this.client.trivium.flush({ database: targetDb });
      } catch {
        /* flush 失败不影响构建结果 */
      }

      this._emit('done', upserted, diff.upserts.length, '索引构建完成');
      return {
        database: targetDb,
        upserted,
        deleted: deletes.length,
        unchanged: diff.unchangedCount,
        links: linkCount,
      };
    } finally {
      this._running = false;
    }
  }
}

/**
 * 从图谱元素与设置发起一次语义索引构建（编排入口，供 index.js 调用）。
 *
 * @param {object} options
 * @param {Array<object>} options.elements - 图谱元素（推荐 window.TimelinesExtensionApi.getTimelineTree()）。
 * @param {string} options.namespace - 作用域键（如 char_12 / group_3）。
 * @param {object} options.settings - Timelines 设置（semanticEndpoint / semanticBatchSize）。
 * @param {Function} [options.getHeaders] - 宿主鉴权头获取函数（getRequestHeaders）。
 * @param {boolean} [options.forceRebuild=false]
 * @param {Function} [options.onProgress]
 * @param {Function} [options.resolveFullText] - async (nodeData) => string|null，省内存模式下解析节点全文。
 * @returns {Promise<object>} build 结果摘要。
 */
export async function runSemanticIndexBuild({
  elements,
  namespace,
  settings = {},
  getHeaders = null,
  forceRebuild = false,
  onProgress = null,
  resolveFullText = null,
}) {
  const status = getAuthorityStatus();
  if (status.status !== 'ready') {
    throw new Error(`Authority 未就绪（当前状态: ${status.status}${status.reason ? ` - ${status.reason}` : ''}）`);
  }
  const client = await getAuthorityClient();
  const provider = createEmbeddingProvider({
    endpoint: settings.semanticEndpoint || '/api/embeddings/compute',
    batchSize: Number(settings.semanticBatchSize) || 8,
    getHeaders,
  });
  const indexer = new SemanticIndexer({ client, provider, namespace, onProgress, resolveFullText });
  return await indexer.build({ elements, forceRebuild });
}

/**
 * 查询语义索引状态（Trivium 统计 + 状态表计数）。
 *
 * @param {object} options
 * @param {string} options.namespace - 作用域键。
 * @returns {Promise<{ok: boolean, nodeCount: number, edgeCount: number, vectorDim: number|null, database: string|null, indexedCount: number, lastIndexedAt: string|null, error: string|null}>}
 */
export async function getSemanticIndexStatus({ namespace }) {
  const status = getAuthorityStatus();
  if (status.status !== 'ready') {
    return { ok: false, error: `Authority ${status.status}`, nodeCount: 0, edgeCount: 0, vectorDim: null, database: null, indexedCount: 0, lastIndexedAt: null };
  }
  try {
    const client = await getAuthorityClient();
    let indexedCount = 0;
    let lastIndexedAt = null;
    try {
      await client.sql.migrate({ database: 'main', migrations: INDEX_STATE_MIGRATIONS });
      const resp = await client.sql.query({
        database: 'main',
        statement: 'SELECT COUNT(*) AS cnt, MAX(indexed_at) AS last_at FROM index_state WHERE namespace = ?',
        params: [namespace],
      });
      const row = (resp?.rows ?? resp ?? [])[0];
      indexedCount = Number(row?.cnt ?? 0);
      lastIndexedAt = row?.last_at ?? null;
    } catch {
      /* 状态表尚不存在时按 0 计 */
    }

    // 从状态表推导当前库名（未构建过则返回占位）
    let database = null;
    try {
      const dbResp = await client.sql.query({
        database: 'main',
        statement: 'SELECT trivium_db FROM index_state WHERE namespace = ? LIMIT 1',
        params: [namespace],
      });
      database = ((dbResp?.rows ?? dbResp ?? [])[0])?.trivium_db ?? null;
    } catch {
      /* ignore */
    }

    if (database) {
      const stat = await client.trivium.stat({ database });
      return {
        ok: true,
        nodeCount: Number(stat?.nodeCount ?? 0),
        edgeCount: Number(stat?.edgeCount ?? 0),
        vectorDim: stat?.vectorDim ?? null,
        database,
        indexedCount,
        lastIndexedAt,
        error: null,
      };
    }

    return { ok: true, nodeCount: 0, edgeCount: 0, vectorDim: null, database: null, indexedCount, lastIndexedAt, error: null };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err), nodeCount: 0, edgeCount: 0, vectorDim: null, database: null, indexedCount: 0, lastIndexedAt: null };
  }
}
