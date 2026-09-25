/**
 * SillyTavern Timelines - Authority HTTP Fetch Adapter
 * 把浏览器 fetch 签名翻译为 Authority client.http.fetch（服务端出网代理）
 *
 * 职责：
 * 1. 纯逻辑：请求/响应形状翻译（无 DOM、无宿主依赖，Node 可测）。
 * 2. 边界：client.http.fetch 按 hostname 授权并审计出网；本适配器不做任何密钥保管——
 *    鉴权头由调用方（provider）随请求传入，与宿主其他密钥同安全域。
 *
 * Authority 合同（shared-types/http.ts）：
 *   请求  {url, method?, headers?, body?, bodyEncoding?}
 *   响应  {url, hostname, status, ok, headers, body, bodyEncoding, contentType}
 */

/**
 * 判断给定 Authority client 是否具备 http.fetch 能力。
 * @param {object} client
 * @returns {boolean}
 */
export function supportsAuthorityHttpFetch(client) {
  return Boolean(client && typeof client?.http?.fetch === 'function');
}

/**
 * 创建浏览器 fetch 兼容的 Authority 服务端出网适配器。
 *
 * @param {object} client - Authority client（需具备 client.http.fetch）。
 * @returns {(url: string, init?: {method?: string, headers?: Record<string,string>, body?: string}) => Promise<ResponseLike>}
 * @throws {Error} client 不具备 http.fetch 时立即抛出（调用方应降级到宿主通道）。
 */
export function createAuthorityHttpFetchAdapter(client) {
  if (!supportsAuthorityHttpFetch(client)) {
    throw new Error('Authority client 不具备 http.fetch 能力（版本过旧或未授权声明）');
  }

  return async function authorityFetch(url, init = {}) {
    const method = String(init?.method ?? 'GET').toUpperCase();
    const headers = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[String(key)] = String(value);
    }

    const response = await client.http.fetch({
      url: String(url),
      method,
      headers,
      ...(init?.body != null ? { body: String(init.body), bodyEncoding: 'utf8' } : {}),
    });

    return buildResponseLike(response);
  };
}

/**
 * 将 Authority HttpFetchResponse 组装为 Response-like（fetch 消费方所需的最小面）。
 * @param {object} response - Authority HttpFetchResponse。
 * @returns {{ok: boolean, status: number, headers: {get: Function}, json: Function, text: Function}}
 */
export function buildResponseLike(response) {
  const body = String(response?.body ?? '');
  const status = Number(response?.status ?? 0);
  const headerMap = new Map(Object.entries(response?.headers ?? {}).map(([k, v]) => [String(k).toLowerCase(), String(v)]));

  return {
    ok: Boolean(response?.ok) || (status >= 200 && status < 300),
    status,
    headers: {
      get(name) {
        return headerMap.get(String(name).toLowerCase()) ?? null;
      },
    },
    text: async () => body,
    json: async () => {
      try {
        return JSON.parse(body);
      } catch (err) {
        throw new Error(`响应体不是合法 JSON（status=${status}）: ${body.slice(0, 80)}`);
      }
    },
  };
}
