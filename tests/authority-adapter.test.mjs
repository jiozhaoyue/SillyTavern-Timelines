import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthorityStateMachine,
  initAuthorityAdapter,
  getAuthorityClient,
  getAuthorityStatus,
  setAuthorityFeatureEnabled,
  resetAuthorityAdapterForTests,
  AUTHORITY_EXTENSION_ID,
  AUTHORITY_DECLARED_PERMISSIONS,
} from '../src/adapters/authority-adapter.js';

// detect() 契约：返回已解包的 AuthoritySDK（与默认探测器的 window.STAuthority.AuthoritySDK 对齐）
function makeStubSdk(initImpl) {
  return { init: initImpl ?? (async () => ({ marker: 'client' })) };
}

test('authority state machine allows only legal transitions', () => {
  const sm = createAuthorityStateMachine();

  assert.equal(sm.get().status, 'absent');

  // absent -> connecting -> ready
  sm.transition('initStarted');
  assert.equal(sm.get().status, 'connecting');
  sm.transition('initSuccess');
  assert.equal(sm.get().status, 'ready');

  // ready -> disabled -> absent（enable 语义：重新可用但未初始化）
  sm.transition('disable');
  assert.equal(sm.get().status, 'disabled');
  sm.transition('enable');
  assert.equal(sm.get().status, 'absent');

  // absent -> connecting -> error（含 reason）
  sm.transition('initStarted');
  sm.transition('initFailed', '用户拒绝授权');
  const errState = sm.get();
  assert.equal(errState.status, 'error');
  assert.equal(errState.reason, '用户拒绝授权');

  // 非法转移被忽略
  sm.transition('initSuccess'); // error 态不允许直接 initSuccess
  assert.equal(sm.get().status, 'error');

  // reset 回到 absent
  sm.transition('reset');
  assert.equal(sm.get().status, 'absent');

  // 非法初始值兜底
  assert.equal(createAuthorityStateMachine('bogus').get().status, 'absent');
});

test('authority state machine notifies subscribers with unsubscribe', () => {
  const sm = createAuthorityStateMachine();
  const seen = [];
  const unsub = sm.subscribe(status => seen.push(status));

  sm.transition('initStarted');
  unsub();
  sm.transition('initSuccess');

  assert.deepEqual(seen, ['connecting']);
});

test('initAuthorityAdapter stays absent when SDK is not installed', async () => {
  resetAuthorityAdapterForTests();
  const ok = await initAuthorityAdapter({ detect: () => null });
  assert.equal(ok, false);
  assert.equal(getAuthorityStatus().status, 'absent');
  await assert.rejects(() => getAuthorityClient(), err => err.code === 'AUTHORITY_NOT_READY');
});

test('initAuthorityAdapter reaches ready with a present SDK and exposes the client', async () => {
  resetAuthorityAdapterForTests();
  let capturedConfig = null;
  const ok = await initAuthorityAdapter({
    version: '9.9.9',
    detect: () =>
      makeStubSdk(async config => {
        capturedConfig = config;
        return { stub: true };
      }),
  });

  assert.equal(ok, true);
  assert.equal(getAuthorityStatus().status, 'ready');
  const client = await getAuthorityClient();
  assert.deepEqual(client, { stub: true });

  // 身份与最小权限声明契约
  assert.equal(capturedConfig.extensionId, AUTHORITY_EXTENSION_ID);
  assert.equal(capturedConfig.version, '9.9.9');
  assert.deepEqual(capturedConfig.declaredPermissions, AUTHORITY_DECLARED_PERMISSIONS);
  assert.ok(!('agent' in capturedConfig.declaredPermissions));
  assert.ok(!('fs' in capturedConfig.declaredPermissions));
  // Phase 2：http.fetch 为 embedding 服务端出网代理（设置默认关，仅启用时实际调用）
  assert.deepEqual(capturedConfig.declaredPermissions.http, { fetch: true });
  // L1-MF-5：未实际使用的能力不得声明（Timelines 只调用 trivium.* / sql.* / http.fetch）
  assert.ok(!('storage' in capturedConfig.declaredPermissions));
  assert.ok(!('jobs' in capturedConfig.declaredPermissions));

  // 幂等：二次 init 不再调用 SDK
  let extraCall = 0;
  await initAuthorityAdapter({
    detect: () => makeStubSdk(async () => { extraCall += 1; return {}; }),
  });
  assert.equal(extraCall, 0);
});

test('initAuthorityAdapter records error state and honors the cooldown window', async () => {
  resetAuthorityAdapterForTests();
  let attempts = 0;
  const failingDetect = () =>
    makeStubSdk(async () => {
      attempts += 1;
      throw new Error('插件未启动');
    });

  const ok = await initAuthorityAdapter({ detect: failingDetect });
  assert.equal(ok, false);
  assert.equal(getAuthorityStatus().status, 'error');
  assert.match(getAuthorityStatus().reason, /插件未启动/);
  assert.equal(attempts, 1);

  // 冷却期内第二次调用不再触发 SDK init
  const ok2 = await initAuthorityAdapter({ detect: failingDetect });
  assert.equal(ok2, false);
  assert.equal(attempts, 1);
});

test('feature toggle drives disabled state both ways', async () => {
  resetAuthorityAdapterForTests();

  setAuthorityFeatureEnabled(false);
  assert.equal(getAuthorityStatus().status, 'disabled');
  const ok = await initAuthorityAdapter({ detect: () => makeStubSdk() });
  assert.equal(ok, false);
  assert.equal(getAuthorityStatus().status, 'disabled');

  setAuthorityFeatureEnabled(true);
  assert.equal(getAuthorityStatus().status, 'absent'); // 重新可用，等待 init
});
