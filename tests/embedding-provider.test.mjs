import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmbeddingUnavailableError,
  hashText,
  chunkTexts,
  createEmbeddingProvider,
} from '../src/embedding-provider.js';

test('hashText is stable and sensitive to input', () => {
  assert.equal(hashText('龙与城堡'), hashText('龙与城堡'));
  assert.notEqual(hashText('龙与城堡'), hashText('龙与 城堡'));
  assert.equal(hashText(''), '811c9dc5'); // FNV-1a 空串偏移基准
  assert.equal(hashText(null), hashText('')); // null 归一为空串
  assert.match(hashText('anything'), /^[0-9a-f]{8}$/);
});

test('chunkTexts slices by batch size with boundary handling', () => {
  assert.deepEqual(chunkTexts([], 8), []);
  assert.deepEqual(chunkTexts(['a', 'b'], 0), [['a'], ['b']]); // 非法批次按 1 处理
  assert.deepEqual(chunkTexts(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(chunkTexts(['x'], 8), [['x']]);
});

function makeFetchMock(responder) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return responder(calls.length, url, options);
  };
  return { fetchImpl, calls };
}

test('createEmbeddingProvider embeds texts in order and caches by content', async () => {
  const { fetchImpl, calls } = makeFetchMock(() => ({
    ok: true,
    json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
  }));
  const provider = createEmbeddingProvider({ batchSize: 2, fetchImpl });

  const first = await provider.embed(['a', 'b', 'c']);
  assert.equal(first.length, 3);
  assert.deepEqual(first[0], [0.1, 0.2, 0.3]);
  assert.equal(provider.dim, 3);
  assert.equal(calls.length, 3); // 逐条请求（ST /api/embeddings/compute 为单文本接口）

  const second = await provider.embed(['a', 'd']);
  assert.equal(calls.length, 4); // 'a' 命中缓存，仅 'd' 发起请求
  assert.deepEqual(second[0], first[0]);
});

test('createEmbeddingProvider surfaces endpoint failures and trips the circuit breaker', async () => {
  let failing = true;
  const { fetchImpl } = makeFetchMock(() => ({
    ok: !failing,
    status: 500,
    json: async () => (failing ? {} : { embedding: [0.1, 0.2, 0.3] }),
  }));
  const provider = createEmbeddingProvider({ batchSize: 1, fetchImpl });

  // 连续 3 次失败触发熔断
  await assert.rejects(() => provider.embed(['a']), EmbeddingUnavailableError);
  await assert.rejects(() => provider.embed(['b']), EmbeddingUnavailableError);
  await assert.rejects(() => provider.embed(['c']), EmbeddingUnavailableError);

  // 熔断后即使端点恢复也直接短路
  failing = false;
  await assert.rejects(
    () => provider.embed(['d']),
    err => err instanceof EmbeddingUnavailableError && /熔断/.test(err.message),
  );

  provider.resetFailure();
  const ok = await provider.embed(['e']);
  assert.deepEqual(ok[0], [0.1, 0.2, 0.3]);
});

test('createEmbeddingProvider rejects when fetch is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = undefined; // 模拟无 fetch 环境
    const provider = createEmbeddingProvider({ fetchImpl: null });
    await assert.rejects(() => provider.embed(['x']), EmbeddingUnavailableError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createEmbeddingProvider converts network-level errors into circuit failures', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed'); // 模拟断网
  };
  const provider = createEmbeddingProvider({ batchSize: 1, fetchImpl });
  await assert.rejects(() => provider.embed(['a']), err => err instanceof EmbeddingUnavailableError && /网络请求失败/.test(err.message));
});
