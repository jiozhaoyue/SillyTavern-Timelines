/**
 * SillyTavern Timelines - Incremental Merge
 * Cytoscape 元素增量 diff 与补丁应用（渐进渲染核心）
 *
 * 职责：
 * 1. 纯函数：对比前后两份元素数组，产出 id 级 {added, updated, removed} 补丁。
 * 2. 应用：在 cy.batch 内把补丁落到现有 Cytoscape 实例（只增改，不整图重建）。
 * 3. 兜底定位：渐进期为新增节点按父节点位置派生预设坐标，防止 worker 布局未就绪时堆叠在原点。
 *
 * 设计约束：diff 与位置计算为纯逻辑（Node 可测）；applyElementPatch 依赖 cy 实例（可注入 mock）。
 */

/**
 * 稳定序列化元素 data（键序归一），用于变化检测。
 *
 * @param {object} data - 元素 data 对象。
 * @returns {string}
 */
function stableSerializeData(data) {
  if (!data || typeof data !== 'object') return JSON.stringify(data ?? null);
  const keys = Object.keys(data).sort();
  const parts = [];
  for (const key of keys) {
    const value = data[key];
    parts.push(
      `${key}:${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`,
    );
  }
  return parts.join('|');
}

/**
 * 对比前后两份 Cytoscape 元素数组（纯函数）。
 *
 * buildGraph 输入前缀确定性保证已有节点 id 稳定；新增文件带来的变化形态：
 *   - 全新节点/边 → added
 *   - 已有节点 chat_sessions 扩展、swipe 统计元数据更新 → updated
 *   - 已消失元素（理论上不出现）→ removed
 *
 * @param {Array<object>} prevElements - 当前已渲染元素。
 * @param {Array<object>} nextElements - 新构建元素。
 * @returns {{added: Array<object>, updated: Array<object>, removed: Array<object>}}
 */
export function diffCytoscapeElements(prevElements, nextElements) {
  const prev = Array.isArray(prevElements) ? prevElements : [];
  const next = Array.isArray(nextElements) ? nextElements : [];

  const prevMap = new Map();
  for (const el of prev) {
    if (el?.data?.id != null) prevMap.set(el.data.id, el);
  }

  const nextMap = new Map();
  const added = [];
  const updated = [];

  for (const el of next) {
    if (el?.data?.id == null) continue;
    nextMap.set(el.data.id, el);
    const prevEl = prevMap.get(el.data.id);
    if (!prevEl) {
      added.push(el);
    } else if (
      stableSerializeData(prevEl.data) !== stableSerializeData(el.data) ||
      (prevEl.group ?? (prevEl.data?.source ? 'edges' : 'nodes')) !== (el.group ?? (el.data?.source ? 'edges' : 'nodes'))
    ) {
      updated.push(el);
    }
  }

  const removed = [];
  for (const [id, el] of prevMap.entries()) {
    if (!nextMap.has(id)) removed.push(el);
  }

  return { added, updated, removed };
}

/**
 * 把补丁应用到 Cytoscape 实例（只增改，不整图重建）。
 *
 * @param {object} cy - Cytoscape 实例（或兼容 mock）。
 * @param {{added: Array, updated: Array, removed: Array}} diff - diffCytoscapeElements 输出。
 */
export function applyElementPatch(cy, diff) {
  if (!cy || typeof cy.batch !== 'function') return;
  const { added = [], updated = [], removed = [] } = diff ?? {};

  cy.batch(() => {
    for (const el of removed) {
      const target = cy.getElementById(el.data.id);
      if (target && target.nonempty()) target.remove();
    }
    for (const el of added) {
      cy.add(el);
    }
    for (const el of updated) {
      const target = cy.getElementById(el.data.id);
      if (target && target.nonempty()) target.data(el.data);
    }
  });
}

/**
 * 渐进期兜底定位：为新增节点派生预设坐标（纯计算）。
 *
 * 规则：有入边（parent 已在 cy 中）的新节点 → 父位置 + 网格偏移；
 * 无父可依 → 以根节点为锚螺旋展开。同一父节点的多个子节点横向铺开。
 *
 * @param {Array<object>} addedElements - diff.added 中的新增元素。
 * @param {Function} getPosition - (elementId) => {x, y} | null，查询 cy 中已有节点位置。
 * @param {object} [options] - {dx=90, dy=140, perRow=4}
 * @returns {Map<string, {x: number, y: number}>} nodeId -> 位置（仅节点；边不含位置）。
 */
export function assignProgressivePositions(addedElements, getPosition, { dx = 90, dy = 140, perRow = 4 } = {}) {
  const added = Array.isArray(addedElements) ? addedElements : [];
  const lookup = typeof getPosition === 'function' ? getPosition : () => null;
  const positions = new Map();

  const nodes = added.filter(el => el?.data && !el.data.source && el.data.id !== 'root');
  const parentSpawn = new Map(); // parentNodeId -> 已派生子节点数
  let orphanSeed = 0;

  for (const el of nodes) {
    const nodeId = el.data.id;
    if (positions.has(nodeId)) continue;

    // 入边来源（本批新增边）或渐进父标记；都无则锚定 root
    const incoming = added.find(e => e?.data?.source && e.data.target === nodeId);
    const parentId = incoming?.data?.source ?? el.data._progressiveParentId ?? null;

    const parentPos = parentId
      ? positions.get(parentId) ?? lookup(parentId) ?? { x: 0, y: 0 }
      : lookup('root') ?? { x: 0, y: 0 };

    let spawnIndex;
    if (parentId) {
      spawnIndex = parentSpawn.get(parentId) ?? 0;
      parentSpawn.set(parentId, spawnIndex + 1);
    } else {
      spawnIndex = orphanSeed++;
    }

    const row = Math.floor(spawnIndex / perRow);
    const col = spawnIndex % perRow;
    positions.set(nodeId, {
      x: (parentPos.x ?? 0) + col * dx,
      y: (parentPos.y ?? 0) + dy + row * dy,
    });
  }

  return positions;
}
