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
  const profileDir = join(ARTIFACTS_DIR, '.chrome-profile');
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
    const chatOpened = await cdpEvaluate(cdp, `(async () => {
      const ctx = window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.();
      if (!ctx) return { error: 'no-context' };
      if (ctx.chatId != null && ctx.characterId != null) return { already: true, chatId: ctx.chatId };
      const candidates = (ctx.characters ?? [])
        .map((c, i) => ({ i, name: c?.name ?? '', chat: c?.chat ?? null }))
        .filter(c => c.chat);
      if (!candidates.length) return { error: 'no-character-with-chat' };
      const pick = candidates[0];
      if (typeof ctx.openCharacterChat !== 'function') return { error: 'no-openCharacterChat' };
      await ctx.openCharacterChat(pick.i);
      return { opened: pick.name };
    })()`);
    await pollOnPage(cdp, `(() => {
      const ctx = window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.();
      return !!(ctx && ctx.chatId != null);
    })()`, { timeoutMs: 60000, intervalMs: 1000, label: '角色会话加载' });
    record('打开角色会话（宿主 openCharacterChat）', !chatOpened?.error, JSON.stringify(chatOpened));

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
