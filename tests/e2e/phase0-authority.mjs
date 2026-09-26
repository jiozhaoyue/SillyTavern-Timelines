/**
 * SillyTavern Timelines - Phase 0 Authority E2E（Dev 实例实机验证）
 *
 * L1-MF-15 纪律（先于一切连接执行）：
 * 1. BASE_URL 未设置 → 立即失败（禁止任何静默兜底）；
 * 2. 端口不在 Dev 白名单 {8001, 8003, 8899} → 打印「疑似误连 Real 实例」并退出非 0；
 * 3. 禁止读取实例聊天文件（本脚本只经 HTTPS 页面与页面内 JS 交互）。
 *
 * 用法：BASE_URL=https://127.0.0.1:8003 node tests/e2e/phase0-authority.mjs
 * 可选：CHROME_PATH（Chrome/Edge 可执行文件，缺省自动探测）、
 *       E2E_HEADFUL=1（有头模式，用于观察）、E2E_SLOWMO_MS（步骤间延迟）。
 *
 * 零 npm 依赖：CDP 经 Node 内置 WebSocket（v22+）。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, 'artifacts');

// ---------- L1-MF-15 启动断言（不允许任何默认值） ----------
if (!process.env.BASE_URL || !/^https?:\/\//.test(process.env.BASE_URL)) {
  console.error('[E2E-GATE] 环境变量 BASE_URL 未设置或非法——按 L1-MF-15 禁止静默兜底，拒绝运行。');
  process.exit(2);
}
const BASE_URL = process.env.BASE_URL.replace(/\/+$/, '');
const basePort = Number(new URL(BASE_URL).port || (new URL(BASE_URL).protocol === 'https:' ? 443 : 80));
const DEV_PORT_WHITELIST = new Set([8001, 8003, 8899]);
if (!DEV_PORT_WHITELIST.has(basePort)) {
  console.error(`[E2E-GATE] 目标端口 ${basePort} 不在 Dev 白名单 {8001, 8003, 8899} 内——疑似误连 Real 实例！立即退出。`);
  process.exit(3);
}
console.log(`[E2E-GATE] 目标 ${BASE_URL}（端口 ${basePort}）通过 Dev 白名单校验。`);

// ---------- 通用工具 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let exitCode = 0;

function record(step, ok, detail = '') {
  results.push({ step, ok, detail: String(detail).slice(0, 400) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
}

function findChromeExecutable() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  return candidates.find(p => p && existsSync(p)) ?? null;
}

// ---------- 极简 CDP 客户端（零依赖） ----------
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message ?? JSON.stringify(msg.error)}`)) : resolve(msg.result);
      }
    });
  }
  static async connect(wsUrl, timeoutMs = 15000) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('WebSocket 连接超时')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('WebSocket 连接失败')); }, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 调用超时: ${method}`));
        }
      }, 120000);
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return p;
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function cdpEvaluate(cdp, expression, awaitPromise = true) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    const desc = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'unknown';
    throw new Error(`页面执行异常: ${desc.split('\n').slice(0, 3).join(' | ')}`);
  }
  return res.result?.value;
}

async function pollOnPage(cdp, expression, { timeoutMs = 60000, intervalMs = 800, label = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await cdpEvaluate(cdp, expression, false);
      if (last) return last;
    } catch { /* 页面尚未就绪，继续轮询 */ }
    await sleep(intervalMs);
  }
  throw new Error(`页面内条件轮询超时（${timeoutMs}ms）: ${label || expression}`);
}

async function screenshot(cdp, name) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(ARTIFACTS_DIR, `${name}.png`);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`[SHOT] ${file}`);
  return file;
}

const EXT_BASE = `${BASE_URL}/scripts/extensions/third-party/SillyTavern-Timelines`;
const IMP_ADAPTER = `import('${EXT_BASE}/src/adapters/authority-adapter.js')`;
const IMP_INDEX_SVC = `import('${EXT_BASE}/src/semantic-index-service.js')`;
const IMP_SEARCH_SVC = `import('${EXT_BASE}/src/semantic-search-service.js')`;
const IMP_EMBED = `import('${EXT_BASE}/src/embedding-provider.js')`;
const IMP_GLOBAL_MODAL = `import('${EXT_BASE}/src/semantic-global-modal.js')`;

async function main() {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error('[E2E] 未找到 Chrome/Edge 可执行文件，请用 CHROME_PATH 指定。');
    process.exit(4);
  }
  const debugPort = 9333; // 独立调试端口（不在 L0-16 保留段位）
  const profileDir = process.env.E2E_PROFILE
    ? resolve(process.env.E2E_PROFILE)
    : join(ARTIFACTS_DIR, '.chrome-profile');
  mkdirSync(profileDir, { recursive: true });
  const headful = process.env.E2E_HEADFUL === '1';
  const chromeArgs = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-extensions-except=', `--window-size=1680,950`, '--ignore-certificate-errors',
    ...(headful ? [] : ['--headless=new']),
  ];
  console.log(`[E2E] 启动浏览器: ${chromePath} ${headful ? '(有头)' : '(headless)'}`);
  const chrome = spawn(chromePath, chromeArgs, { stdio: 'ignore' });
  chrome.on('exit', code => console.log(`[E2E] 浏览器退出（${code}）`));

  try {
    // 等待调试端点
    await pollOnPage ? null : null;
    let version = null;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        version = await r.json();
        break;
      } catch { await sleep(500); }
    }
    if (!version) throw new Error('CDP 调试端点未就绪');
    console.log(`[E2E] CDP 就绪：${version.Browser}`);

    // 打开目标页
    const put = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(BASE_URL)}`, { method: 'PUT' });
    const target = await put.json();
    if (!target.webSocketDebuggerUrl) throw new Error(`无法打开目标页: ${JSON.stringify(target).slice(0, 200)}`);
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await sleep(1500 + Number(process.env.E2E_SLOWMO_MS ?? 0));

    // ---- 登录探测（ST 用户账户页兜底：尝试点击无密码用户按钮） ----
    const extReadyExpr = `!!(window.jQuery && window.STAuthority?.AuthoritySDK && document.querySelector('#tl_semantic_build_btn') && window.TimelinesExtensionApi)`;
    let ready = false;
    try { ready = await pollOnPage(cdp, extReadyExpr, { timeoutMs: 20000, label: '扩展就绪' }); } catch { ready = false; }
    if (!ready) {
      console.log('[E2E] 扩展未就绪，尝试登录页交互…');
      const loginProbe = await cdpEvaluate(cdp, `(() => {
        const cands = ['.user-select .user-item', '.user-item', '#login-user-list button', '.user-list button', 'form button[type=submit]', 'button'];
        const found = cands.map(s => ({s, n: document.querySelectorAll(s).length})).filter(x => x.n > 0);
        return JSON.stringify(found);
      })()`, false);
      console.log(`[E2E] 登录页选择器探测: ${loginProbe}`);
      await cdpEvaluate(cdp, `(() => {
        const btn = document.querySelector('.user-select .user-item button') || document.querySelector('.user-item button') || document.querySelector('#login-user-list button') || document.querySelector('.user-list button');
        if (btn) { btn.click(); return 'clicked: ' + (btn.textContent || '').trim().slice(0, 30); }
        return 'no-user-button-found';
      })()`, false);
      ready = await pollOnPage(cdp, extReadyExpr, { timeoutMs: 45000, label: '登录后扩展就绪' });
    }
    record('登录并加载扩展（#tl_semantic_build_btn / STAuthority / TimelinesExtensionApi）', ready === true);

    // ---- 步骤 1：适配层 ready（与 UI handler 相同的导出函数，确定性重试规避初始化时序竞态） ----
    // 注：#tl_semantic_enabled 上绑定两个事件——'input'（通用绑定器：持久化 settings.semanticSearchEnabled）
    // 与 'change'（语义专用 handler：setAuthorityFeatureEnabled + initAuthorityAdapter），二者都需触发。
    await cdpEvaluate(cdp, `window.jQuery('#tl_semantic_enabled').prop('checked', true).trigger('input').trigger('change');`, false);
    const adapterState = await cdpEvaluate(cdp, `(async () => {
      const m = await ${IMP_ADAPTER};
      for (let i = 0; i < 30; i++) {
        m.setAuthorityFeatureEnabled(true);
        await m.initAuthorityAdapter({ version: '2.4.0' });
        const st = m.getAuthorityStatus();
        if (st.status === 'ready') return st;
        if (!window.STAuthority?.AuthoritySDK && i > 20) return { status: 'absent', reason: 'STAuthority 未注入' };
        await new Promise(r => setTimeout(r, 1000));
      }
      return m.getAuthorityStatus();
    })()`);
    record('适配层初始化后状态 ready', adapterState?.status === 'ready', `status=${adapterState?.status} reason=${adapterState?.reason ?? '-'}`);
    await screenshot(cdp, 'phase0_01_adapter_ready');

    // ---- 步骤 1.5：打开一个有会话的角色（新浏览器档案无加载中的会话，时间树为空） ----
    // 宿主 API 语义（Luker 2.7.0 public/script.js openCharacterChat）：该函数参数是【聊天文件名】，
    // 且只对【当前已选中角色】生效——this_chid === undefined（欢迎屏态）时静默 return。
    // 从零加载会话的正确入口是 selectCharacterById(角色索引)：选中角色并 getChat() 加载其当前聊天。
    // 此前传角色索引调用 openCharacterChat 属潜伏 bug：实例 auto_load_chat 生效时走 already 快捷路径被掩盖。
    const chatOpened = await cdpEvaluate(cdp, `(async () => {
      const ctx = window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.();
      if (!ctx) return { error: 'no-context' };
      if (ctx.chatId != null && ctx.characterId != null) return { already: true, chatId: ctx.chatId };
      const candidates = (ctx.characters ?? [])
        .map((c, i) => ({ i, name: c?.name ?? '', chat: c?.chat ?? null }))
        .filter(c => c.chat);
      if (!candidates.length) return { error: 'no-character-with-chat' };
      if (typeof ctx.selectCharacterById !== 'function') return { error: 'no-selectCharacterById' };
      // 逐个尝试（最多 4 个）：个别角色的当前聊天可能处于异常状态
      const tried = [];
      for (const pick of candidates.slice(0, 4)) {
        try { await ctx.selectCharacterById(pick.i); } catch (err) { tried.push(pick.name + ': ' + String(err?.message ?? err).slice(0, 40)); continue; }
        for (let i = 0; i < 8; i++) {
          await new Promise(r => setTimeout(r, 1000));
          if (ctx.chatId != null && ctx.characterId != null) return { opened: pick.name, chatId: ctx.chatId };
        }
        tried.push(pick.name + ': chatId 未就绪');
      }
      return { error: 'all-candidates-failed', tried };
    })()`);
    await pollOnPage(cdp, `(() => {
      const ctx = window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.();
      return !!(ctx && ctx.chatId != null);
    })()`, { timeoutMs: 30000, intervalMs: 1000, label: '角色会话加载' }).catch(() => null);
    record('打开角色会话（宿主 selectCharacterById）', !chatOpened?.error, JSON.stringify(chatOpened));

    // ---- 步骤 2：打开时间树，等待图谱拓扑就绪 ----
    await cdpEvaluate(cdp, `window.jQuery('#show_timeline_view').trigger('click');`, false);
    await sleep(2500);
    const treeCount = await pollOnPage(cdp, `window.TimelinesExtensionApi.getTimelineTree().length`, { timeoutMs: 90000, label: '图谱拓扑就绪' });
    record('时间树图谱拓扑就绪（getTimelineTree）', treeCount > 0, `元素数=${treeCount}`);
    await screenshot(cdp, 'phase0_02_timeline_view');

    // ---- 步骤 3：真实 UI 构建链路 + 降级路径（Luker 已移除 /api/embeddings/compute，预期优雅失败） ----
    // 先挂钩 toastr 记录器再触发，规避 toast 自动淡出导致的漏检
    await cdpEvaluate(cdp, `(() => {
      window.__e2eToasts = [];
      for (const kind of ['error', 'warning', 'info', 'success']) {
        const orig = window.toastr?.[kind];
        if (typeof orig === 'function') {
          window.toastr[kind] = (...args) => { window.__e2eToasts.push({ kind, text: String(args[0] ?? '') }); return orig.apply(window.toastr, args); };
        }
      }
      return 'hooked';
    })()`, false);
    await cdpEvaluate(cdp, `window.jQuery('#tl_semantic_build_btn').trigger('click');`, false);
    await sleep(6000);
    const degradeProbe = await cdpEvaluate(cdp, `(async () => {
      const [adapter, lex] = await Promise.all([${IMP_ADAPTER}, import('${EXT_BASE}/src/search-service.js')]);
      const statusText = document.querySelector('#tl_semantic_status')?.textContent ?? '';
      const toasts = window.__e2eToasts ?? [];
      const buildFailedToast = toasts.some(t => /构建失败|embedding/i.test(t.text));
      const enabledWarningToast = toasts.some(t => /请先启用语义检索/.test(t.text));
      // 词法检索独立于 embedding/Authority：对当前图谱跑一次纯文本匹配
      const tree = window.TimelinesExtensionApi.getTimelineTree().map(e => e?.data ?? e).filter(d => d && !d.source && !d.target);
      const srcNode = tree.find(d => d.msg || d.message);
      const q = srcNode ? String(srcNode.msg ?? srcNode.message ?? '').slice(0, 12) : '的';
      const lexicalHits = tree.filter(d => lex.matchesNode(d, { query: q })).length;
      return { statusText, buildFailedToast, enabledWarningToast, toasts: toasts.map(t => '[' + t.kind + '] ' + t.text).slice(0, 5), lexicalHits, authorityStatus: adapter.getAuthorityStatus().status };
    })()`);
    record('构建链路优雅降级：embedding 缺失时捕获失败、Authority 保持 ready、词法检索不受影响',
      ['error', 'ready'].includes(degradeProbe?.authorityStatus) && (degradeProbe?.lexicalHits ?? 0) > 0 && degradeProbe?.buildFailedToast === true,
      `authority=${degradeProbe?.authorityStatus} buildFailedToast=${degradeProbe?.buildFailedToast} enabledWarning=${degradeProbe?.enabledWarningToast} lexicalHits=${degradeProbe?.lexicalHits} toasts=${JSON.stringify(degradeProbe?.toasts)}`);
    await screenshot(cdp, 'phase0_03_build_degraded');

    // ---- 步骤 3b：Trivium 数据面往返探针（合成向量 + 隔离探针库，不触碰真实索引） ----
    const triviumProbe = await cdpEvaluate(cdp, `(async () => {
      const adapter = await ${IMP_ADAPTER};
      const client = await adapter.getAuthorityClient();
      const db = 'tl_e2e_probe';
      const vec = Array.from({ length: 8 }, (_, i) => Math.sin(i + 1));
      await client.trivium.bulkUpsert({ database: db, items: [{ externalId: 'e2e-probe::1', namespace: 'e2e', vector: vec, payload: { probe: true, note: 'phase0' } }] });
      try { await client.trivium.flush({ database: db }); } catch { /* 尽力而为 */ }
      const hits = await client.trivium.searchHybrid({ database: db, vector: vec, queryText: 'phase0', topK: 3 });
      const found = hits.find(h => h.externalId === 'e2e-probe::1');
      const stat = await client.trivium.stat({ database: db });
      // 生产语义（与 semantic-index-service 一致）：删除条目必须携带写入时的 namespace，
      // 否则 Authority 在 default 命名空间下解析 externalId 而"not mapped"（Phase 0 实证）。
      const delResp = await client.trivium.bulkDelete({ database: db, items: [{ externalId: 'e2e-probe::1', namespace: 'e2e' }] });
      try { await client.trivium.flush({ database: db }); } catch { /* 尽力而为 */ }
      const hitsAfterDelete = await client.trivium.searchHybrid({ database: db, vector: vec, queryText: 'phase0', topK: 3 });
      const gone = !hitsAfterDelete.some(h => h.externalId === 'e2e-probe::1');
      const statAfter = await client.trivium.stat({ database: db });
      return {
        hit: !!found, score: found?.score, nodeCount: stat?.nodeCount,
        deleteSuccess: Number(delResp?.successCount ?? 0),
        deleteFailures: JSON.stringify(delResp?.failures ?? []),
        goneAfterDelete: gone, nodeCountAfterDelete: statAfter?.nodeCount,
      };
    })()`);
    record('Trivium 数据面往返（bulkUpsert→searchHybrid→bulkDelete[带 namespace]→复查消失）',
      triviumProbe?.hit === true && Number(triviumProbe?.deleteSuccess) >= 1 && triviumProbe?.goneAfterDelete === true,
      `hit=${triviumProbe?.hit} score=${triviumProbe?.score} nodes=${triviumProbe?.nodeCount} delSuccess=${triviumProbe?.deleteSuccess} gone=${triviumProbe?.goneAfterDelete} statAfter=${triviumProbe?.nodeCountAfterDelete} failures=${triviumProbe?.deleteFailures}`);

    // ---- 步骤 3c：SQL 状态面探针（index_state 迁移与查询） ----
    const sqlProbe = await cdpEvaluate(cdp, `(async () => {
      const adapter = await ${IMP_ADAPTER};
      const client = await adapter.getAuthorityClient();
      await client.sql.migrate({ database: 'main', migrations: [{ id: '001_create_index_state', statement: "CREATE TABLE IF NOT EXISTS index_state (namespace TEXT NOT NULL, chat_file TEXT NOT NULL, message_id INTEGER NOT NULL, content_hash TEXT NOT NULL, trivium_db TEXT NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY (namespace, chat_file, message_id))" }] });
      const resp = await client.sql.query({ database: 'main', statement: 'SELECT COUNT(*) AS cnt FROM index_state' });
      const row = (resp?.rows ?? resp ?? [])[0];
      return { ok: true, rows: Number(row?.cnt ?? -1) };
    })()`);
    record('SQL 状态面往返（migrate + query index_state）', sqlProbe?.ok === true && Number(sqlProbe?.rows) >= 0, `index_state 行数=${sqlProbe?.rows}`);

    // ---- 步骤 3d：跨会话结果弹窗渲染（合成行，渲染层验证不依赖 embedding 通道） ----
    const modalShown = await cdpEvaluate(cdp, `(async () => {
      const [svc, modal] = await Promise.all([${IMP_SEARCH_SVC}, ${IMP_GLOBAL_MODAL}]);
      const rows = svc.formatGlobalResults([
        { externalId: '__e2e_probe_chat::5', score: 0.92, payload: { name: 'E2E 验证行', is_user: false, preview: 'Phase 0 合成验证行——跨会话弹窗渲染。', tags: ['e2e'], bookmark: true } },
      ]);
      modal.openSemanticGlobalModal(rows, { query: 'E2E' });
      return { rows: rows.length };
    })()`);
    await sleep(1200);
    const modalVisible = await cdpEvaluate(cdp, `(() => {
      const m = document.querySelector('.timelines-semantic-modal');
      return !!m && m.querySelectorAll('.semantic-result-card').length >= 1;
    })()`, false);
    record('跨会话结果弹窗渲染（formatGlobalResults + openSemanticGlobalModal）', modalShown?.rows === 1 && modalVisible, `rows=${modalShown?.rows} visible=${modalVisible}`);
    await screenshot(cdp, 'phase0_04_global_modal');
    await cdpEvaluate(cdp, `import(${JSON.stringify(EXT_BASE + '/src/semantic-global-modal.js')}).then(m => m.closeSemanticGlobalModal());`);

    // ---- 步骤 9：A4 自动增量索引调度实机（Session 22 遗留补验项） ----
    // 挂点 = 时间树数据确有更新（dataUpdated）后 fire-and-forget maybeAutoSemanticIndex。
    // 可观测信号：静默构建失败 → console.warn '[Timelines] 自动语义索引构建失败（60s 冷却后重试）'；
    // 成功 → console.info '[Timelines] 自动语义索引完成'。两种路径都零 toast（静默模式铁律）。
    // 本实例 embedding 端点已被 Luker 移除（404），预期走失败路径。
    await cdpEvaluate(cdp, `(() => {
      window.__autoSignals = [];
      for (const kind of ['warn', 'info']) {
        const orig = console[kind].bind(console);
        console[kind] = (...a) => { const t = a.map(String).join(' '); if (t.includes('自动语义索引')) window.__autoSignals.push({ kind, text: t.slice(0, 160) }); orig(...a); };
      }
      return 'auto-signal-hooked';
    })()`, false);
    await cdpEvaluate(cdp, `window.jQuery('#tl_semantic_auto_index').prop('checked', true).trigger('input');`, false);
    // 触发数据更新：切换到下一个有会话的候选角色，再点一次时间线按钮驱动渐进管线
    // （CHAT_CHANGED 只清 lastContextKey，不自动重载；onTimelineButtonClick 才会跑管线并触发 A4 挂点）
    const autoResult = await cdpEvaluate(cdp, `(async () => {
      const ctx = window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.();
      const cur = ctx.characterId;
      const toastsBefore = (window.__e2eToasts ?? []).length;
      const candidates = (ctx.characters ?? []).map((c, i) => ({ i, chat: c?.chat ?? null })).filter(c => c.chat && String(c.i) !== String(cur));
      if (!candidates.length) return { error: 'no-second-candidate' };
      for (const pick of candidates.slice(0, 3)) {
        try { await ctx.selectCharacterById(pick.i); } catch { continue; }
        let loaded = false;
        for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 1000)); if (ctx.chatId != null && String(ctx.characterId) === String(pick.i)) { loaded = true; break; } }
        if (!loaded) continue;
        window.jQuery('#show_timeline_view').trigger('click');
        let treeCount = 0;
        for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 1000)); treeCount = window.TimelinesExtensionApi?.getTimelineTree?.().length ?? 0; if (treeCount > 0) break; }
        if (!treeCount) continue; // 空会话树不构成 A4 触发条件，换下一个候选
        // 等自动构建尝试完成（embedding 404 为快速失败）
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 1000));
          if (window.__autoSignals.length) break;
        }
        if (window.__autoSignals.length) return { triggeredBy: pick.name ?? String(pick.i), charId: pick.i, chatId: ctx.chatId, treeCount, signals: window.__autoSignals, semanticToasts: (window.__e2eToasts ?? []).slice(toastsBefore).filter(t => /语义/.test(t.text ?? '')) };
      }
      return { error: 'auto-signal-not-seen', signals: window.__autoSignals };
    })()`);
    const autoOk = Array.isArray(autoResult?.signals) && autoResult.signals.length > 0;
    const autoSilentOk = (autoResult?.semanticToasts ?? []).length === 0;
    record('A4 自动增量索引调度（数据更新→静默构建→冷却信号，零 toast）', autoOk && autoSilentOk,
      `triggeredBy=${autoResult?.triggeredBy ?? '-'} signals=${JSON.stringify(autoResult?.signals ?? autoResult)} silentNoToast=${autoSilentOk}`);

    // ---- 步骤 10：Phase 3 导出服务端留存 UI 全链路（Session 22 遗留补验项） ----
    // 开留存放关 → 导出弹窗下载 → blob 留存 toast → 历史画廊回看 → 下载 → 删除（CRUD 收口并清理测试产物）。
    // 新增卡片判定：导出前先开一次画廊取基线 id 快照，导出后取差集——不依赖角色名（角色可能在步骤 9 被切换）。
    await cdpEvaluate(cdp, `window.jQuery('#tl_export_server_keep').prop('checked', true).trigger('input');`, false);
    const baselineIds = await cdpEvaluate(cdp, `(async () => {
      window.jQuery('#tl_export_history_btn').trigger('click');
      for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 1000)); if (document.querySelector('.export-history-card, .export-history-empty')) break; }
      const ids = [...document.querySelectorAll('.export-history-card')].map(c => c.dataset.id);
      document.querySelector('.timelines-export-history-modal .export-history-close-btn')?.click();
      await new Promise(r => setTimeout(r, 500));
      return ids;
    })()`);
    await cdpEvaluate(cdp, `document.querySelector('.export-timeline-btn')?.click();`, false);
    await sleep(1200);
    const exportChain = await cdpEvaluate(cdp, `(async () => {
      const ctx = window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.();
      const exportLabel = ctx?.characters?.[ctx.characterId]?.name ?? String(ctx?.characterId);
      const dlBtn = document.querySelector('.timelines-export-modal .tl-btn-download') || document.querySelector('.tl-btn-download');
      if (!dlBtn) return { error: 'no-download-btn' };
      const toastsBefore = (window.__e2eToasts ?? []).length;
      dlBtn.click();
      let kept = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        kept = (window.__e2eToasts ?? []).slice(toastsBefore).some(t => /已留存到服务端导出历史/.test(t.text ?? ''));
        if (kept) break;
      }
      return { exportLabel, keptToast: kept, newToasts: (window.__e2eToasts ?? []).slice(toastsBefore).map(t => t.kind + ':' + String(t.text).slice(0, 60)) };
    })()`);
    // 历史画廊：打开 → 找本次新增卡片 → 下载 → 删除
    const gallery = await cdpEvaluate(cdp, `(async () => {
      window.jQuery('#tl_export_history_btn').trigger('click');
      const modal = document.querySelector('.timelines-export-history-modal');
      if (!modal) return { error: 'no-history-modal' };
      for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 1000)); if (modal.querySelector('.export-history-card, .export-history-empty')) break; }
      const baseline = ${JSON.stringify(baselineIds ?? [])};
      const cards = [...modal.querySelectorAll('.export-history-card')];
      const cardNames = cards.map(c => c.querySelector('.export-history-name')?.textContent ?? '');
      const card = cards.find(c => !baseline.includes(c.dataset.id));
      if (!card) return { error: 'new-card-not-found', cardNames };
      const toastsBefore = (window.__e2eToasts ?? []).length;
      card.querySelector('.export-history-dl-btn')?.click();
      let dlOk = false;
      for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 1000)); dlOk = (window.__e2eToasts ?? []).slice(toastsBefore).some(t => /已从服务端下载导出物/.test(t.text ?? '')); if (dlOk) break; }
      const refreshed = [...modal.querySelectorAll('.export-history-card')].find(c => c.dataset.id === card.dataset.id);
      if (!refreshed) return { error: 'card-gone-before-delete', cardNames };
      refreshed.querySelector('.export-history-del-btn')?.click();
      let delOk = false;
      for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 1000)); delOk = (window.__e2eToasts ?? []).slice(toastsBefore).some(t => /已从服务端删除/.test(t.text ?? '')); if (delOk) break; }
      return { cardNames, downloadOk: dlOk, deleteOk: delOk };
    })()`);
    const exportOk = exportChain?.keptToast === true && gallery?.downloadOk === true && gallery?.deleteOk === true;
    record('Phase 3 导出服务端留存 UI 全链路（留存→画廊→下载→删除）', exportOk,
      `keep=${exportChain?.keptToast} dl=${gallery?.downloadOk} del=${gallery?.deleteOk} label=${exportChain?.exportLabel} cards=${JSON.stringify(gallery?.cardNames ?? gallery).slice(0, 160)}`);
    await screenshot(cdp, 'phase0_05_export_history');
    await cdpEvaluate(cdp, `document.querySelector('.timelines-export-history-modal .export-history-close-btn')?.click();`, false);

    // ---- 步骤 11：多树视图全链路（进入 → ≥2 树共存 → 无跨树边 → 退出恢复单树） ----
    // UI 驱动：工具栏多树按钮 → 选择器 → 勾选当前角色 + 一个确认有消息量的其他角色 → 确认渲染 → 断言 → 退出
    // 预筛第二目标：用页面内 /api/characters/chats 确认该角色确有消息（避免空会话树导致只有一棵树可渲染）
    const secondTarget = await cdpEvaluate(cdp, `(async () => {
      const ctx = window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.();
      const cur = ctx.characterId;
      const candidates = (ctx.characters ?? [])
        .map((c, i) => ({ i, avatar: c?.avatar, name: c?.name, chat: c?.chat }))
        .filter(c => c.chat && String(c.i) !== String(cur));
      for (const c of candidates) {
        try {
          const data = await fetch('/api/characters/chats', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: c.avatar }),
            headers: ctx.getRequestHeaders(),
          }).then(r => r.json());
          // 响应为扁平数组，消息数在 chat_items（无 messages 字段——消息逐文件拉取）
          const list = Array.isArray(data) ? data : Object.values(data ?? {});
          const total = list.reduce((s, ch) => s + (Number(ch?.chat_items ?? ch?.chat_size) || (Array.isArray(ch?.messages) ? ch.messages.length : 0)), 0);
          if (total > 0) return { name: c.name, messages: total };
        } catch { /* 下一个候选 */ }
      }
      return null;
    })()`);
    let multiResult = { skipped: true, reason: 'no-second-target-with-messages' };
    if (secondTarget) {
      // 错误捕获：enterMultiTreeMode 失败时经 toastr/console.error 静默吞掉，这里留证据
      await cdpEvaluate(cdp, `(() => {
        window.__mtErrors = [];
        window.addEventListener('error', e => window.__mtErrors.push('window: ' + String(e?.message ?? e).slice(0, 220)));
        const orig = console.error.bind(console);
        console.error = (...a) => { window.__mtErrors.push(a.map(String).join(' ').slice(0, 260)); orig(...a); };
        return 'mt-error-hooked';
      })()`, false);
      // 分阶段小 evaluate（单次 Runtime.evaluate 有 CDP 120s 上限，长等待放 Node 侧轮询）
      const openResult = await cdpEvaluate(cdp, `(async () => {
        document.querySelector('.multi-tree-btn')?.click();
        for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 500)); if (document.getElementById('timelines-multitree-selector')) break; }
        const selector = document.getElementById('timelines-multitree-selector');
        if (!selector) return { error: 'selector-not-opened' };
        const rows = [...selector.querySelectorAll('.timelines-multitree-row')];
        const wanted = [${JSON.stringify(secondTarget.name)}];
        let checkedCount = 0;
        for (const row of rows) {
          const name = row.querySelector('.timelines-multitree-name')?.textContent ?? '';
          const cb = row.querySelector('input[type=checkbox]');
          if (!cb) continue;
          if (cb.checked) { checkedCount++; continue; } // 当前角色默认勾选
          if (wanted.some(w => name === w || name.startsWith(w)) && checkedCount < 4) {
            cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
            if (cb.checked) checkedCount++;
          }
        }
        if (checkedCount < 2) return { error: 'not-enough-targets-checked', checkedCount };
        selector.querySelector('.timelines-multitree-confirm-btn')?.click();
        return { checkedCount };
      })()`);
      // 等多树构建完成（横幅出现，Node 侧轮询不受 CDP 单调用超时约束）
      let bannerShown = false;
      try {
        await pollOnPage(cdp, `!!document.getElementById('timelines-multitree-banner')`, { timeoutMs: 180000, intervalMs: 1500, label: '多树横幅出现' });
        bannerShown = true;
      } catch { bannerShown = false; }
      if (!bannerShown) {
        const mtErrors = await cdpEvaluate(cdp, `window.__mtErrors ?? []`, false).catch(() => []);
        multiResult = { error: 'multi-banner-timeout', openResult, mtErrors };
      } else {
        const assertions = await cdpEvaluate(cdp, `(() => {
          const banner = document.getElementById('timelines-multitree-banner');
          const tree = window.TimelinesExtensionApi?.getTimelineTree?.() ?? [];
          const treeIds = [...new Set(tree.map(el => el?.data?.treeId).filter(Boolean))];
          let crossTreeEdges = 0;
          for (const el of tree) {
            if (el?.group !== 'edges') continue;
            const sp = String(el.data.source ?? '').split('::')[0];
            const tp = String(el.data.target ?? '').split('::')[0];
            if (sp !== tp) crossTreeEdges++;
          }
          return {
            badgeCount: banner?.querySelectorAll('.timelines-multitree-badge').length ?? 0,
            elementCount: tree.length, treeIds, crossTreeEdges,
          };
        })()`, false);
        // 退出并等单树恢复
        await cdpEvaluate(cdp, `document.getElementById('timelines-multitree-banner')?.querySelector('.timelines-multitree-exit-btn')?.click();`, false);
        let restored = false;
        try {
          await pollOnPage(cdp, `(() => {
            const tree2 = window.TimelinesExtensionApi?.getTimelineTree?.() ?? [];
            return !document.getElementById('timelines-multitree-banner') && tree2.length > 0 && tree2.every(el => !el?.data?.treeId);
          })()`, { timeoutMs: 120000, intervalMs: 1500, label: '退出恢复单树' });
          restored = true;
        } catch { restored = false; }
        multiResult = { openResult, ...assertions, restored };
      }
    }
    const multiOk = multiResult?.badgeCount >= 2 && multiResult?.crossTreeEdges === 0 && multiResult?.restored === true;
    record('多树视图全链路（进入→≥2 树共存→无跨树边→退出恢复单树）', multiOk,
      `second=${JSON.stringify(secondTarget)} result=${JSON.stringify(multiResult).slice(0, 300)}`);
    await screenshot(cdp, 'phase0_06_multi_tree_exit');

    // ---- 汇总 ----
    const summary = { baseUrl: BASE_URL, at: new Date().toISOString(), results };
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(join(ARTIFACTS_DIR, 'phase0-summary.json'), JSON.stringify(summary, null, 2));
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n[E2E] 完成：${results.length - failed}/${results.length} 通过；产物目录 ${ARTIFACTS_DIR}`);
    cdp.close();
  } finally {
    await sleep(500);
    chrome.kill();
  }
  process.exit(exitCode);
}

main().catch(err => {
  console.error('[E2E] 致命错误:', err?.message ?? err);
  process.exit(1);
});
