/**
 * 多树视图纯函数模块（跨角色/群组同屏）。
 *
 * 设计依据：.trellis/tasks/09-26-multi-tree-view-design/design.md（2026-09-26 用户裁定通过，
 * 决策点采纳 D1a 手选多选器 / D2a 树内 Dagre + 树间网格平移 / D3a 单 cy 实例 / D4a 默认 LOD 折叠 / D5b 含群组树）。
 *
 * 职责边界（L1-MF-11：图算法纯函数、与 DOM/Cytoscape 生命周期解耦、Node 100% 单测）：
 * - 树身份 `makeTreeId`：与语义 namespace 同构（char_<id> / group_<id>）。
 * - 预算 `assertTreeBudget`：同屏树数按设备档位上限，超限在取数前拒绝。
 * - 作用域化 `scopeTreeElements`：仅重写图元素的 id 引用并打 treeId 标——
 *   绝不触碰 chat_sessions / file_name / bookmarkName 等导航数据字段（导航与书签死链检查依赖原始文件名）。
 * - 拼装 `composeMultiTreePositions`：树内相对坐标整体平移到网格分区，确定性输出。
 * - 聚合 `buildMultiTreeElements`：拼接 + 全局 id 唯一性不变量（L1-MF-11 强去重）。
 */

/** 同屏树数上限（memory-profile 的 memorySaver 弱设备档视为 mobile）。 */
export const MAX_TREES_BY_PROFILE = { desktop: 4, mobile: 2 };

/**
 * 生成树命名空间 id。与语义索引 namespace（index.js makeSemanticNamespace）同构：
 * 角色 `char_<characterId>`、群组 `group_<groupId>`。
 *
 * @param {{characterId?: string|number|null, groupId?: string|number|null}} target
 * @returns {string} treeId。
 */
export function makeTreeId({ characterId = null, groupId = null } = {}) {
  if (characterId != null && characterId !== '') return `char_${characterId}`;
  if (groupId != null && groupId !== '') return `group_${groupId}`;
  return 'char_unknown';
}

/**
 * 校验同屏树数是否在设备档位预算内。
 *
 * @param {{treeCount: number, profile?: 'desktop'|'mobile'}} params
 * @returns {{ok: boolean, reason?: string, max: number}}
 */
export function assertTreeBudget({ treeCount, profile = 'desktop' } = {}) {
  const max = MAX_TREES_BY_PROFILE[profile] ?? MAX_TREES_BY_PROFILE.desktop;
  if (!Number.isInteger(treeCount) || treeCount < 1) {
    return { ok: false, reason: 'tree-count-invalid', max };
  }
  if (treeCount > max) {
    return { ok: false, reason: `tree-limit-exceeded(${max})`, max };
  }
  return { ok: true, max };
}

/**
 * 将一棵树的 Cytoscape 元素数组作用域化到指定 treeId：
 * - 所有 data.id、边 data.source/target、节点 data.storedSwipes 内层的 node.id 与 edge.id/source/target
 *   统一加 `<treeId>::` 前缀（buildGraph 的 id 为构建期计数器 messageN/edgeN/swipeN-M，
 *   另有固定根 id 'root'，多树同屏必冲突，见 design.md F4）；
 * - 每个元素 data 打上 treeId 字段（导航与树归属判定使用）；
 * - 深拷贝产出，不修改入参；chat_sessions / file_name / bookmarkName / msg 等数据字段原样保留。
 *
 * @param {Array<{group: string, data: object}>} elements - buildGraph/convertToCytoscapeElements 输出。
 * @param {string} treeId - 树命名空间 id。
 * @returns {Array<{group: string, data: object}>} 作用域化后的新数组。
 */
export function scopeTreeElements(elements, treeId) {
  if (!treeId) throw new Error('scopeTreeElements: treeId 不能为空');
  const prefix = `${treeId}::`;
  const rewriteId = id => (id == null ? id : `${prefix}${id}`);
  const out = [];
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || typeof el !== 'object' || !el.data) continue;
    const data = { ...el.data, treeId };
    data.id = rewriteId(el.data.id);
    if (el.group === 'edges') {
      data.source = rewriteId(el.data.source);
      data.target = rewriteId(el.data.target);
    }
    if (Array.isArray(el.data.storedSwipes)) {
      data.storedSwipes = el.data.storedSwipes.map(({ node, edge } = {}) => ({
        node: node ? { ...node, id: rewriteId(node.id) } : node,
        edge: edge
          ? { ...edge, id: rewriteId(edge.id), source: rewriteId(edge.source), target: rewriteId(edge.target) }
          : edge,
      }));
    }
    out.push({ group: el.group, data });
  }
  return out;
}

/**
 * 计算一组 positions 的包围盒。
 *
 * @param {Record<string, {x: number, y: number}>} positions - 节点 id → 坐标。
 * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number, empty: boolean}}
 */
export function boundingBoxOf(positions) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of Object.values(positions ?? {})) {
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, empty: true };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, empty: false };
}

/**
 * 多树网格拼装（D2a）：每棵树的布局坐标作为整体平移到行优先网格分区，树与树之间保持 gap 间距。
 * 确定性：同一输入永远得到同一输出；树内任意两节点的相对位移在平移后保持不变。
 *
 * @param {Array<{treeId: string, positions: Record<string, {x: number, y: number}>|null}>} treeLayouts
 * @param {{columns?: number, gap?: number}} [options] - columns 缺省 2；gap 缺省 120。
 * @returns {{positions: Record<string, {x: number, y: number}>, boxes: Array<{treeId: string} & ReturnType<typeof boundingBoxOf>>}}
 */
export function composeMultiTreePositions(treeLayouts, { columns = 2, gap = 120 } = {}) {
  const colCount = Math.max(1, Math.floor(columns) || 1);
  const safeGap = Number.isFinite(gap) && gap >= 0 ? gap : 120;
  const trees = (Array.isArray(treeLayouts) ? treeLayouts : []).map(t => ({
    treeId: t?.treeId ?? `tree_${Math.random()}`,
    positions: t?.positions ?? {},
    box: boundingBoxOf(t?.positions),
  }));
  if (!trees.length) return { positions: {}, boxes: [] };

  const rowCount = Math.ceil(trees.length / colCount);
  const colWidths = new Array(colCount).fill(0);
  const rowHeights = new Array(rowCount).fill(0);
  trees.forEach((t, i) => {
    const col = i % colCount;
    const row = Math.floor(i / colCount);
    colWidths[col] = Math.max(colWidths[col], t.box.width);
    rowHeights[row] = Math.max(rowHeights[row], t.box.height);
  });

  const positions = {};
  const boxes = [];
  const colOffsets = colWidths.map(((_, c) =>
    colWidths.slice(0, c).reduce((acc, w, idx) => acc + w + safeGap, 0)));
  const rowOffsets = rowHeights.map(((_, r) =>
    rowHeights.slice(0, r).reduce((acc, h, idx) => acc + h + safeGap, 0)));

  trees.forEach((t, i) => {
    const col = i % colCount;
    const row = Math.floor(i / colCount);
    const dx = colOffsets[col] - t.box.minX;
    const dy = rowOffsets[row] - t.box.minY;
    for (const [id, p] of Object.entries(t.positions)) {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      positions[id] = { x: p.x + dx, y: p.y + dy };
    }
    boxes.push({
      treeId: t.treeId,
      minX: t.box.empty ? colOffsets[col] : t.box.minX + dx,
      minY: t.box.empty ? rowOffsets[row] : t.box.minY + dy,
      maxX: t.box.empty ? colOffsets[col] : t.box.maxX + dx,
      maxY: t.box.empty ? rowOffsets[row] : t.box.maxY + dy,
      width: t.box.width,
      height: t.box.height,
      empty: t.box.empty,
    });
  });

  return { positions, boxes };
}

/**
 * 跨树导航的角色索引解析：优先用构建时记录的稳定标识 avatar 在当前 characters 数组中重定位
 * （数组运行中可能重排，实机取证；构建时的 refId 索引仅作回退），群组树返回 null。
 *
 * @param {Array<{treeId: string, kind: 'char'|'group', refId: string, avatar?: string|null}>} trees
 * @param {string} treeId
 * @param {Array<{avatar?: string|null}>|null} characters - 当前宿主上下文的 characters 数组。
 * @returns {number|null} 角色索引；无法解析时 null。
 */
export function resolveTreeCharacterIndex(trees, treeId, characters) {
  const tree = (Array.isArray(trees) ? trees : []).find(t => t?.treeId === treeId);
  if (!tree || tree.kind !== 'char') return null;
  const list = Array.isArray(characters) ? characters : [];
  let idx = list.findIndex(c => c?.avatar != null && c.avatar === tree.avatar);
  if (idx < 0) idx = Number(tree.refId);
  return Number.isInteger(idx) && idx >= 0 && list[idx] ? idx : null;
}

/**
 * 拼接多棵已作用域化的树元素为单画布元素集合，并校验全局 id 唯一性
 * （L1-MF-11 强去重；重复即抛错——重复意味着 scopeTreeElements 漏写或树间 treeId 撞车）。
 *
 * @param {Array<Array<{group: string, data: object}>>} scopedTrees
 * @returns {Array<{group: string, data: object}>}
 */
export function buildMultiTreeElements(scopedTrees) {
  const seen = new Set();
  const out = [];
  for (const tree of Array.isArray(scopedTrees) ? scopedTrees : []) {
    for (const el of Array.isArray(tree) ? tree : []) {
      const id = el?.data?.id;
      if (id != null) {
        if (seen.has(id)) {
          throw new Error(`buildMultiTreeElements: 元素 id 冲突（${id}）——作用域化不完整或 treeId 重复`);
        }
        seen.add(id);
      }
      out.push(el);
    }
  }
  return out;
}
