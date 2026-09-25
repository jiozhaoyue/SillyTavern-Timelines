/**
 * SillyTavern Timelines - Embedding Provider
 * 可插拔向量化提供方（Authority 语义索引的前置依赖）
 *
 * 职责：
 * 1. 将文本批量转换为 embedding 向量（默认走 SillyTavern 原生 /api/embeddings/compute）。
 * 2. 文本哈希内存缓存，重复文本零网络开销。
 * 3. 连续失败熔断（EmbeddingUnavailableError），让上层整体降级而非反复撞墙。
 *
 * 设计约束：本模块必须可在 Node 测试环境独立导入运行，
 * 严禁静态导入宿主模块（script.js / jQuery 等），鉴权头经 getHeaders 注入。
 */

/** 连续失败熔断阈值 */
const FAILURE_CIRCUIT_LIMIT = 3;

/**
 * embeddings 接口连续失败时抛出；上层捕获后应关闭语义搜索并提示用户。
 */
export class EmbeddingUnavailableError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
    this.cause = cause;
  }
}

/**
 * FNV-1a 32 位字符串哈希（同步、稳定、零依赖），用作缓存键与内容指纹。
 *
 * @param {string} text - 任意文本。
 * @returns {string} 8 位十六进制哈希。
 */
export function hashText(text) {
  const str = String(text ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 将文本数组按批次大小切片（纯函数）。
 *
 * @param {Array<string>} texts - 文本列表。
 * @param {number} batchSize - 批次大小（>=1）。
 * @returns {Array<Array<string>>} 批次二维数组；输入为空返回空数组。
 */
export function chunkTexts(texts, batchSize) {
  const size = Math.max(1, Number(batchSize) || 1);
  const source = Array.isArray(texts) ? texts : [];
  const chunks = [];
  for (let i = 0; i < source.length; i += size) {
    chunks.push(source.slice(i, i + size));
  }
  return chunks;
}

/**
 * 创建 embedding 提供方实例。
 *
 * @param {object} [options]
 * @param {string} [options.endpoint='/api/embeddings/compute'] - 向量化端点。
 * @param {number} [options.batchSize=8] - 每批请求的文本数（串行逐条请求）。
 * @param {Function} [options.getHeaders] - () => object，返回宿主鉴权请求头（浏览器由 index.js 注入 getRequestHeaders）。
 * @param {Function} [options.fetchImpl] - 自定义 fetch（测试注入）；缺省用全局 fetch。
 * @param {string} [options.model=''] - 非空时请求体附带 `model` 与 `input:[text]`（OpenAI 兼容端点），
 *   同时保留 `text` 字段（ST 兼容中转端取所需）。
 * @param {string} [options.apiKey=''] - 非空时携带 `Authorization: Bearer <key>` 头（密钥存宿主设置，随请求出网）。
 * @param {Function} [options.transportResolver] - async () => fetchImpl，服务端出网通道
 *   （如 Authority http.fetch 适配器）；首次 embed 时解析一次并缓存，解析失败计入熔断。
 * @returns {{embed: Function, dim: (number|null), resetFailure: Function}} 提供方实例。
 */
export function createEmbeddingProvider({
  endpoint = '/api/embeddings/compute',
  batchSize = 8,
  getHeaders = null,
  fetchImpl = null,
  model = '',
  apiKey = '',
  transportResolver = null,
} = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const cache = new Map(); // hashText -> vector
  let consecutiveFailures = 0;
  let dim = null;
  let broken = false;
  let resolvedTransport = fetchImpl ?? null; // transportResolver 解析结果缓存

  /**
   * 取当前生效的 fetch 实现：显式 fetchImpl > transportResolver 解析 > 全局 fetch。
   */
  async function resolveFetch() {
    if (resolvedTransport) return resolvedTransport;
    if (typeof transportResolver === 'function') {
      resolvedTransport = await transportResolver();
      return resolvedTransport;
    }
    return doFetch;
  }

  /**
   * 请求单条文本的向量。
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async function embedSingle(text) {
    let effectiveFetch = null;
    try {
      effectiveFetch = await resolveFetch();
    } catch (err) {
      // 通道解析失败（如 Authority 未就绪）与网络失败同责：计入熔断
      throw new EmbeddingUnavailableError(`embedding 出网通道解析失败: ${err?.message ?? err}`, err);
    }
    if (!effectiveFetch) {
      throw new EmbeddingUnavailableError('当前环境无可用 fetch，无法生成向量');
    }
    const headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(typeof getHeaders === 'function' ? getHeaders() : {}),
    };
    const body = model
      ? JSON.stringify({ text, model, input: [text] })
      : JSON.stringify({ text });
    let response;
    try {
      response = await effectiveFetch(endpoint, {
        method: 'POST',
        headers,
        body,
      });
    } catch (err) {
      // 网络层失败（断网/URL 非法/超时）同样计入熔断
      throw new EmbeddingUnavailableError(`embedding 网络请求失败: ${endpoint}`, err);
    }
    if (!response || typeof response.ok !== 'boolean') {
      throw new EmbeddingUnavailableError(`embedding 端点响应异常: ${endpoint}`);
    }
    if (!response.ok) {
      throw new EmbeddingUnavailableError(`embedding 端点返回 ${response.status}`);
    }
    const data = await response.json();
    const vector = data?.embedding ?? data?.data?.[0]?.embedding ?? null;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new EmbeddingUnavailableError('embedding 响应缺少向量字段');
    }
    return vector;
  }

  /**
   * 将文本列表转换为向量列表（顺序与输入一致；缓存命中不发起请求）。
   *
   * @param {Array<string>} texts
   * @returns {Promise<Array<number[]>>}
   * @throws {EmbeddingUnavailableError} 连续 ${FAILURE_CIRCUIT_LIMIT} 批失败后抛出。
   */
  async function embed(texts) {
    const source = Array.isArray(texts) ? texts : [];
    if (source.length === 0) return [];

    if (broken) {
      throw new EmbeddingUnavailableError('embedding 提供方已熔断，请检查端点配置后重置');
    }

    const results = new Array(source.length).fill(null);
    const pending = []; // {index, text, hash}

    source.forEach((text, index) => {
      const hash = hashText(text);
      if (cache.has(hash)) {
        results[index] = cache.get(hash);
      } else {
        pending.push({ index, text, hash });
      }
    });

    const chunks = chunkTexts(pending, batchSize);
    for (const chunk of chunks) {
      try {
        for (const item of chunk) {
          const vector = await embedSingle(item.text);
          cache.set(item.hash, vector);
          results[item.index] = vector;
          if (dim === null) dim = vector.length;
        }
        consecutiveFailures = 0; // 任一批成功即复位
      } catch (err) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= FAILURE_CIRCUIT_LIMIT) {
          broken = true;
          throw new EmbeddingUnavailableError(`embedding 连续 ${consecutiveFailures} 批失败，已熔断`, err);
        }
        throw err; // 未达熔断阈值时直接上抛，由调用方决定重试节奏
      }
    }

    return results;
  }

  /**
   * 手动复位熔断状态（用户在设置中修改端点后调用）。
   */
  function resetFailure() {
    consecutiveFailures = 0;
    broken = false;
  }

  return {
    embed,
    resetFailure,
    get dim() {
      return dim;
    },
  };
}
