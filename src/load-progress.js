/**
 * SillyTavern Timelines - Load Progress
 * 全程常驻进度条：纯状态机（Node 可测）+ 顶部胶囊 DOM 组件
 *
 * 职责：
 * 1. 纯状态机：跨阶段加权百分比（单调不回退）、阶段文案、完成/失败终态、订阅通知。
 * 2. DOM：画布顶部固定进度胶囊——spinner + 阶段文本 + 处理对象详情 + 确定性进度条；
 *    完成 1.2s 后淡出；失败转红色常驻错误态。
 *
 * 设计约束：纯状态机不触碰 DOM；DOM 组件仅在浏览器环境使用。
 */

/**
 * 阶段权重（总和 100）。data 阶段统一承载「缓存回放 + 网络拉取」两类文件获取，
 * 两者在一次加载中可能先后出现，故共享同一 60% 权重块，处理对象经 detail 展示。
 */
export const PROGRESS_PHASES = {
  list: { weight: 5, label: '正在获取会话列表' },
  data: { weight: 60, label: '正在加载会话数据' },
  build: { weight: 15, label: '正在构建时间树拓扑' },
  layout: { weight: 15, label: '正在布局图面' },
};

/** 阶段顺序（用于权重累加） */
const PHASE_ORDER = ['list', 'data', 'build', 'layout'];

/**
 * 创建进度状态机（纯逻辑，可独立单测）。
 *
 * @returns {{set: Function, done: Function, fail: Function, get: Function, subscribe: Function}}
 */
export function createProgressState() {
  let state = { status: 'idle', phase: null, done: 0, total: 0, detail: null, percent: 0, error: null };
  let maxPercent = 0;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn({ ...state });
      } catch {
        /* 监听器异常不影响状态机 */
      }
    }
  }

  function computePercent(phase, done, total) {
    const config = PROGRESS_PHASES[phase];
    if (!config) return maxPercent;

    // 当前阶段之前（按 PHASE_ORDER）的阶段权重全部计入
    const phaseIndex = PHASE_ORDER.indexOf(phase);
    const precedingWeight = PHASE_ORDER.slice(0, phaseIndex).reduce(
      (sum, key) => sum + PROGRESS_PHASES[key].weight,
      0,
    );

    const innerRatio = Number(total) > 0 ? Math.min(1, Math.max(0, Number(done) / Number(total))) : 0;
    return Math.min(99, precedingWeight + innerRatio * config.weight);
  }

  return {
    /**
     * 上报阶段进度。
     * @param {string} phase - PROGRESS_PHASES 键。
     * @param {object} [options] - {done, total, detail}
     */
    set(phase, { done = 0, total = 0, detail = null } = {}) {
      if (state.status === 'done' || state.status === 'failed') return state;
      const percent = computePercent(phase, done, total);
      if (percent < maxPercent) {
        // 单调不回退：乱序上报时保留已有视觉进度（信息仍更新）
        state = { ...state, status: 'running', phase, done, total, detail };
      } else {
        maxPercent = percent;
        state = { status: 'running', phase, done, total, detail, percent };
      }
      notify();
      return state;
    },

    /** 完成：percent 锁定 100（failed 为终态，不可覆盖） */
    done() {
      if (state.status === 'failed') return state;
      maxPercent = 100;
      state = { ...state, status: 'done', percent: 100, detail: null, error: null };
      notify();
      return state;
    },

    /** 失败：进入红色终态，携带原因（done 为终态，不可覆盖） */
    fail(error) {
      if (state.status === 'done') return state;
      state = { ...state, status: 'failed', error: String(error?.message ?? error ?? '未知错误') };
      notify();
      return state;
    },

    get() {
      return { ...state };
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * 格式化阶段展示文本（含处理对象详情）。
 *
 * @param {object} state - createProgressState 的 get() 输出。
 * @returns {string} 如「正在加载会话数据 (12/40)：branch-a.jsonl」。
 */
export function formatProgressLabel(state) {
  if (!state || state.status === 'idle') return '准备中...';
  if (state.status === 'failed') return `加载失败：${state.error ?? '未知错误'}`;
  if (state.status === 'done') return '时间线就绪';

  const config = PROGRESS_PHASES[state.phase];
  const label = config?.label ?? '处理中';
  const hasCount = Number(state.total) > 0;
  const countText = hasCount ? ` (${Number(state.done)}/${Number(state.total)})` : '';
  const detailText = state.detail ? `：${state.detail}` : '';
  return `${label}${countText}${detailText}`;
}

/**
 * 挂载顶部进度胶囊（浏览器专用）。
 *
 * @param {HTMLElement|string} container - 画布容器或其选择器；进度胶囊插入其内部顶部。
 * @returns {{update: Function, finish: Function, fail: Function, destroy: Function}|null}
 */
export function mountProgressOverlay(container) {
  if (typeof document === 'undefined') return null;
  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (!host) return null;

  document.getElementById('timelines-load-progress')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'timelines-load-progress';
  overlay.className = 'timelines-load-progress';
  overlay.innerHTML = `
    <div class="tlp-inner">
      <span class="tlp-spinner"></span>
      <span class="tlp-label">准备中...</span>
      <span class="tlp-percent">0%</span>
    </div>
    <div class="tlp-bar"><div class="tlp-bar-fill"></div></div>
  `;
  host.appendChild(overlay);

  const labelEl = overlay.querySelector('.tlp-label');
  const percentEl = overlay.querySelector('.tlp-percent');
  const fillEl = overlay.querySelector('.tlp-bar-fill');
  let hideTimer = null;

  function render(state) {
    labelEl.textContent = formatProgressLabel(state);
    const percent = Math.round(state.percent ?? 0);
    percentEl.textContent = `${percent}%`;
    fillEl.style.width = `${percent}%`;

    overlay.classList.toggle('is-failed', state.status === 'failed');
    overlay.classList.toggle('is-done', state.status === 'done');
    overlay.classList.remove('is-hidden');

    if (state.status === 'done') {
      // 完成后短暂展示再淡出
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => overlay.classList.add('is-hidden'), 1200);
    }
  }

  return {
    update(state) {
      render(state);
    },
    finish() {
      render({ status: 'done', percent: 100 });
    },
    fail(error) {
      render({ status: 'failed', percent: 0, error });
    },
    destroy() {
      clearTimeout(hideTimer);
      overlay.remove();
    },
  };
}
