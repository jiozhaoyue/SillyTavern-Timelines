import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supportsAuthorityHttpFetch,
  createAuthorityHttpFetchAdapter,
  buildResponseLike,
} from '../src/authority-http-fetch.js';

function makeClient(fetchImpl) {
  return { http: { fetch: fetchImpl } };
}

test('supportsAuthorityHttpFetch 方法存在性检测', () => {
  assert.equal(supportsAuthorityHttpFetch(makeClient(async () => ({}))), true);
  assert.equal(supportsAuthorityHttpFetch({}), false);
  assert.equal(supportsAuthorityHttpFetch(null), false);
});

test('createAuthorityHttpFetchAdapter 方法缺失时构造即抛错', () => {
  assert.throws(() => createAuthorityHttpFetchAdapter({}), /http\.fetch/);
  assert.throws(() => createAuthorityHttpFetchAdapter(null), /http\.fetch/);
});

test('适配器翻译 GET 请求并组装 Response-like', async () => {
  const captured = {};
  const client = makeClient(async input => {
    Object.assign(captured, input);
    return {
      url: input.url,
      hostname: '127.0.0.1',
      status: 200,
      ok: true,
      headers: { 'Content-Type': 'application/json' },
      body: '{"version":"1.0"}',
      bodyEncoding: 'utf8',
      contentType: 'application/json',
    };
  });
  const fetchLike = createAuthorityHttpFetchAdapter(client);
  const resp = await fetchLike('https://127.0.0.1:8003/version', {
    method: 'GET',
    headers: { 'X-Test': '1' },
  });

  assert.equal(captured.url, 'https://127.0.0.1:8003/version');
  assert.equal(captured.method, 'GET');
  assert.deepEqual(captured.headers, { 'X-Test': '1' });
  assert.equal('body' in captured, false, 'GET 不携带 body 字段');

  assert.equal(resp.ok, true);
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('content-type'), 'application/json');
  assert.deepEqual(await resp.json(), { version: '1.0' });
  assert.equal(await resp.text(), '{"version":"1.0"}');
});

test('适配器翻译 POST 请求：body 走 utf8 编码', async () => {
  const captured = {};
  const client = makeClient(async input => {
    Object.assign(captured, input);
    return { status: 400, ok: false, headers: {}, body: '{"error":"bad"}', bodyEncoding: 'utf8', contentType: 'application/json' };
  });
  const fetchLike = createAuthorityHttpFetchAdapter(client);
  const resp = await fetchLike('https://api.example.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k1' },
    body: JSON.stringify({ text: 'hi' }),
  });

  assert.equal(captured.method, 'POST');
  assert.deepEqual(captured.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer k1' });
  assert.equal(captured.body, '{"text":"hi"}');
  assert.equal(captured.bodyEncoding, 'utf8');
  assert.equal(resp.ok, false);
  assert.equal(resp.status, 400);
  assert.deepEqual(await resp.json(), { error: 'bad' }); // 4xx 响应体仍是合法 JSON，json() 正常解析
});

test('buildResponseLike 容忍缺失字段与非法 JSON', async () => {
  const empty = buildResponseLike(null);
  assert.equal(empty.status, 0);
  assert.equal(empty.ok, false);
  assert.equal(empty.headers.get('x-anything'), null);

  const bad = buildResponseLike({ status: 200, ok: true, body: 'not-json{', headers: {} });
  await assert.rejects(() => bad.json(), /不是合法 JSON/);
});
