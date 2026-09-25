/**
 * SillyTavern Timelines - Authority Adapter
 * ST-Delegation-of-authority 服务端插件适配器（能力嗅探 + 可选降级）
 *
 * 职责：
 * 1. 纯逻辑：权威状态机（absent/disabled/connecting/ready/error）。
 * 2. IO：嗅探 window.STAuthority?.AuthoritySDK 并幂等初始化客户端单例。
 * 3. 对外：getAuthorityClient / getAuthorityStatus / onAuthorityStatusChange。
 *
 * 零耦合约束：不安装 Authority 时适配器停留在 absent，全部上层模块静默休眠，
 * 主图谱链路零影响。本模块必须可在 Node 测试环境独立导入运行。
 */

/** init 失败后的重试冷却（毫秒），避免错误风暴 */
const INIT_RETRY_COOLDOWN_MS = 60_000;

/** Timelines 在 Authority 侧的扩展身份（命名规范：third-party/<name>） */
export const AUTHORITY_EXTENSION_ID = 'third-party/sillytavern-timelines';

/**
 * 最小权限声明（L1-MF-5）：只声明实际调用到的能力。
 *
 * 实际使用面（2026-09-25 对照 Authority 仓 shared-types 逐字段核验）：
 *   - client.trivium.*：bulkUpsert / bulkDelete / bulkLink / searchHybrid /
 *     indexText / createIndex / flush / stat（全部为 private 数据面）
 *   - client.sql.*：migrate / query / batch / exec（index_state 状态表）
 *   - client.http.fetch：embedding 服务端出网代理（Phase 2，按 hostname 运行时授权；
 *     设置开关默认关，仅在用户启用服务端出网通道时实际调用）
 *   - client.storage.blob：导出物服务端留存（Phase 3，设置开关默认关；只声明 blob 不声明 kv）
 * 未使用的能力（storage.kv / jobs.background / fs / agent）一律不声明，
 * 避免用户在 Security Center 授权弹窗看到多余风险项。
 */
export const AUTHORITY_DECLARED_PERMISSIONS = {
  trivium: { private: true },
  sql: { private: true },
  http: { fetch: true },
  storage: { blob: true },
};

/** 合法状态集合 */
const STATUSES = ['absent', 'disabled', 'connecting', 'ready', 'error'];

/**
 * 创建 Authority 状态机（纯逻辑，可独立单测）。
 *
 * 合法转移：
 *   absent     -> connecting | disabled
 *   disabled   -> connecting | absent
 *   connecting -> ready | error | absent
 *   error      -> connecting | disabled | absent
 *   ready      -> connecting | disabled | absent
 * 非法转移静默忽略（返回当前状态）。
 *
 * @param {string} [initial='absent']
 * @returns {{get: Function, transition: Function, subscribe: Function}}
 */
export function createAuthorityStateMachine(initial = 'absent') {
  let current = STATUSES.includes(initial) ? initial : 'absent';
  let reason = null;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn(current, reason);
      } catch {
        /* 监听器异常不影响状态机 */
      }
    }
  }

  return {
    get() {
      return { status: current, reason };
    },
    transition(event, detail = null) {
      const next = {
        initStarted: { from: ['absent', 'disabled', 'error', 'ready'], to: 'connecting' },
        initSuccess: { from: ['connecting'], to: 'ready' },
        initFailed: { from: ['connecting'], to: 'error' },
        disable: { from: ['absent', 'connecting', 'error', 'ready'], to: 'disabled' },
        enable: { from: ['disabled'], to: 'absent' },
        reset: { from: STATUSES, to: 'absent' },
      }[event];

      if (!next || !next.from.includes(current)) {
        return { status: current, reason };
      }
      current = next.to;
      reason = event === 'initFailed' ? String(detail ?? '初始化失败') : event === 'disable' ? String(detail ?? '已在设置中停用') : null;
      notify();
      return { status: current, reason };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---- 模块级单例状态 ----
const stateMachine = createAuthorityStateMachine();
let authorityClient = null;
let initPromise = null;
let lastInitFailureAt = 0;
let featureEnabled = true; // 设置面板总开关（semanticSearchEnabled）镜像

/**
 * 同步/异步驱动状态机并初始化 Authority 客户端（幂等；失败进入 60s 冷却）。
 *
 * 注意：本函数不会重新启用已被 setAuthorityFeatureEnabled(false) 停用的功能；
 * 重新启用必须显式调用 setAuthorityFeatureEnabled(true)（由设置面板驱动）。
 *
 * @param {object} [options]
 * @param {string} [options.version] - Timelines 版本（上报给 Security Center）。
 * @param {Function} [options.detect] - SDK 探测函数（测试注入）；返回已解包的
 *   AuthoritySDK（与缺省嗅探 window.STAuthority.AuthoritySDK 对齐）。
 * @returns {Promise<boolean>} 是否达到 ready。
 */
export async function initAuthorityAdapter({ version = '2.4.0', detect = null } = {}) {
  if (!featureEnabled) {
    stateMachine.transition('disable');
    return false;
  }

  const detectSdk =
    detect ||
    (() => {
      const host = typeof window !== 'undefined' ? window : globalThis;
      return host?.STAuthority?.AuthoritySDK ?? null;
    });

  const sdk = detectSdk();
  if (!sdk || typeof sdk.init !== 'function') {
    // 未安装 Authority：保持 absent，静默休眠
    stateMachine.transition('reset');
    return false;
  }

  // 冷却期内不重试
  if (Date.now() - lastInitFailureAt < INIT_RETRY_COOLDOWN_MS && stateMachine.get().status === 'error') {
    return false;
  }

  if (stateMachine.get().status === 'ready') {
    return true;
  }

  if (!initPromise) {
    stateMachine.transition('initStarted');
    initPromise = (async () => {
      try {
        authorityClient = await sdk.init({
          extensionId: AUTHORITY_EXTENSION_ID,
          displayName: 'SillyTavern Timelines',
          version,
          installType: 'local',
          declaredPermissions: AUTHORITY_DECLARED_PERMISSIONS,
        });
        stateMachine.transition('initSuccess');
        return true;
      } catch (err) {
        authorityClient = null;
        lastInitFailureAt = Date.now();
        stateMachine.transition('initFailed', err?.message ?? String(err));
        return false;
      } finally {
        initPromise = null;
      }
    })();
  }

  return await initPromise;
}

/**
 * 同步设置功能总开关（settings.semanticSearchEnabled 的镜像）。
 *
 * @param {boolean} enabled
 */
export function setAuthorityFeatureEnabled(enabled) {
  featureEnabled = Boolean(enabled);
  if (!featureEnabled && stateMachine.get().status !== 'disabled') {
    stateMachine.transition('disable');
  }
  if (featureEnabled && stateMachine.get().status === 'disabled') {
    stateMachine.transition('enable');
  }
}

/**
 * 获取就绪的 Authority 客户端；未就绪时 reject（上层应降级）。
 *
 * @returns {Promise<object>} AuthorityClient。
 */
export async function getAuthorityClient() {
  if (stateMachine.get().status === 'ready' && authorityClient) {
    return authorityClient;
  }
  const { status, reason } = stateMachine.get();
  const err = new Error(`Authority 未就绪: ${status}${reason ? ` (${reason})` : ''}`);
  err.code = 'AUTHORITY_NOT_READY';
  throw err;
}

/**
 * 获取当前状态快照。
 *
 * @returns {{status: string, reason: string|null}}
 */
export function getAuthorityStatus() {
  return stateMachine.get();
}

/**
 * 订阅状态变化。
 *
 * @param {Function} fn - (status, reason) => void。
 * @returns {Function} 取消订阅函数。
 */
export function onAuthorityStatusChange(fn) {
  return stateMachine.subscribe(fn);
}

/**
 * 重置适配器（仅测试使用）。
 */
export function resetAuthorityAdapterForTests() {
  stateMachine.transition('reset');
  authorityClient = null;
  initPromise = null;
  lastInitFailureAt = 0;
  featureEnabled = true;
}
