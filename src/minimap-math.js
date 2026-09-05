/**
 * @file minimap-math.js
 * 提供时间线全景小地图的坐标投影、逆投影与取景框计算纯数学算法。
 * 与 DOM 和 Cytoscape 实例完全解耦，确保 100% 可单测性。
 */

/**
 * @typedef {Object} ProjectionTransform
 * @property {number} scale - 等比缩放比例
 * @property {number} offsetX - X 轴平移偏移量
 * @property {number} offsetY - Y 轴平移偏移量
 * @property {number} canvasWidth - 画布宽度
 * @property {number} canvasHeight - 画布高度
 */

/**
 * 计算全图包围盒到小地图 Canvas 的等比居中投影参数
 * @param {{x1: number, y1: number, x2: number, y2: number}} graphBounds - 图整体外接矩形
 * @param {number} canvasWidth - Canvas 像素宽度
 * @param {number} canvasHeight - Canvas 像素高度
 * @param {number} [padding=10] - 内边距留白
 * @returns {ProjectionTransform}
 */
export function calculateProjection(graphBounds, canvasWidth, canvasHeight, padding = 10) {
  const x1 = graphBounds?.x1 ?? 0;
  const y1 = graphBounds?.y1 ?? 0;
  const x2 = graphBounds?.x2 ?? 100;
  const y2 = graphBounds?.y2 ?? 100;

  const gw = Math.max(x2 - x1, 1);
  const gh = Math.max(y2 - y1, 1);

  const availW = Math.max(canvasWidth - padding * 2, 1);
  const availH = Math.max(canvasHeight - padding * 2, 1);

  const scale = Math.min(availW / gw, availH / gh);

  const offsetX = padding + (availW - gw * scale) / 2 - x1 * scale;
  const offsetY = padding + (availH - gh * scale) / 2 - y1 * scale;

  return {
    scale,
    offsetX,
    offsetY,
    canvasWidth,
    canvasHeight,
  };
}

/**
 * 将图模型坐标投影为 Canvas 像素坐标
 * @param {{x: number, y: number}} point
 * @param {ProjectionTransform} projection
 * @returns {{x: number, y: number}}
 */
export function modelToCanvas(point, projection) {
  if (!projection || typeof projection.scale !== 'number') {
    return { x: point.x || 0, y: point.y || 0 };
  }
  return {
    x: point.x * projection.scale + projection.offsetX,
    y: point.y * projection.scale + projection.offsetY,
  };
}

/**
 * 将 Canvas 像素坐标逆投影为图模型坐标
 * @param {{x: number, y: number}} point
 * @param {ProjectionTransform} projection
 * @returns {{x: number, y: number}}
 */
export function canvasToModel(point, projection) {
  if (!projection || !projection.scale) {
    return { x: point.x || 0, y: point.y || 0 };
  }
  return {
    x: (point.x - projection.offsetX) / projection.scale,
    y: (point.y - projection.offsetY) / projection.scale,
  };
}

/**
 * 将主画布可见视口 extent 投影为小地图上的取景矩形
 * @param {{x1: number, y1: number, x2: number, y2: number}} extent - 主图当前可见区域
 * @param {ProjectionTransform} projection - 投影参数
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function extentToCanvasRect(extent, projection) {
  if (!extent || !projection) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const p1 = modelToCanvas({ x: extent.x1, y: extent.y1 }, projection);
  const p2 = modelToCanvas({ x: extent.x2, y: extent.y2 }, projection);

  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.max(Math.abs(p2.x - p1.x), 2);
  const height = Math.max(Math.abs(p2.y - p1.y), 2);

  return { x, y, width, height };
}

/**
 * 判定点是否位于矩形区域内
 * @param {{x: number, y: number}} point
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @returns {boolean}
 */
export function isPointInRect(point, rect) {
  if (!point || !rect) return false;
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * 根据目标模型坐标、当前缩放比与视口尺寸，计算将该点居中所需的 Cytoscape pan 平移量
 * @param {{x: number, y: number}} modelPt - 目标模型坐标点
 * @param {number} zoom - 当前 Cytoscape 缩放比率
 * @param {number} viewWidth - 视口像素宽度
 * @param {number} viewHeight - 视口像素高度
 * @returns {{x: number, y: number}}
 */
export function calculateCenterPan(modelPt, zoom, viewWidth, viewHeight) {
  const z = typeof zoom === 'number' && zoom > 0 ? zoom : 1;
  const w = typeof viewWidth === 'number' ? viewWidth : 800;
  const h = typeof viewHeight === 'number' ? viewHeight : 600;
  const mx = modelPt?.x ?? 0;
  const my = modelPt?.y ?? 0;
  return {
    x: w / 2 - mx * z,
    y: h / 2 - my * z,
  };
}
