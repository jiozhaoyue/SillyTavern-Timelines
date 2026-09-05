import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCenterPan,
  calculateProjection,
  canvasToModel,
  extentToCanvasRect,
  isPointInRect,
  modelToCanvas,
} from '../src/minimap-math.js';

test('calculateProjection scales and centers graph into canvas dimensions', () => {
  const graphBounds = { x1: 0, y1: 0, x2: 1000, y2: 500 };
  const canvasWidth = 200;
  const canvasHeight = 100;
  const padding = 10;

  const proj = calculateProjection(graphBounds, canvasWidth, canvasHeight, padding);
  assert.ok(proj.scale > 0);
  assert.equal(proj.canvasWidth, 200);
  assert.equal(proj.canvasHeight, 100);

  // Available width = 180, height = 80.
  // gw = 1000, gh = 500.
  // scale = min(180/1000, 80/500) = min(0.18, 0.16) = 0.16
  assert.ok(Math.abs(proj.scale - 0.16) < 1e-5);
});

test('modelToCanvas and canvasToModel roundtrip faithfully', () => {
  const graphBounds = { x1: 100, y1: -200, x2: 800, y2: 600 };
  const proj = calculateProjection(graphBounds, 300, 150, 10);

  const originalPoint = { x: 350, y: 120 };
  const canvasPt = modelToCanvas(originalPoint, proj);
  const restoredPt = canvasToModel(canvasPt, proj);

  assert.ok(Math.abs(restoredPt.x - originalPoint.x) < 1e-4);
  assert.ok(Math.abs(restoredPt.y - originalPoint.y) < 1e-4);
});

test('extentToCanvasRect converts viewport extent into valid screen rectangle', () => {
  const graphBounds = { x1: 0, y1: 0, x2: 500, y2: 500 };
  const proj = calculateProjection(graphBounds, 200, 200, 0);

  const extent = { x1: 100, y1: 100, x2: 250, y2: 300 };
  const rect = extentToCanvasRect(extent, proj);

  assert.ok(rect.width > 0);
  assert.ok(rect.height > 0);
  assert.ok(rect.x >= 0);
  assert.ok(rect.y >= 0);

  assert.ok(isPointInRect({ x: rect.x + 5, y: rect.y + 5 }, rect));
  assert.equal(isPointInRect({ x: rect.x - 10, y: rect.y + 5 }, rect), false);
  assert.equal(isPointInRect({ x: rect.x + 5, y: rect.y + rect.height + 10 }, rect), false);
});

test('calculateProjection handles edge cases without dividing by zero', () => {
  const singlePoint = { x1: 50, y1: 50, x2: 50, y2: 50 };
  const proj = calculateProjection(singlePoint, 100, 100, 10);
  assert.ok(Number.isFinite(proj.scale));
  assert.ok(proj.scale > 0);
});

test('calculateCenterPan calculates precise pan coordinates for viewport centering', () => {
  const modelPt = { x: 200, y: 150 };
  const zoom = 1.5;
  const viewWidth = 1000;
  const viewHeight = 600;

  const pan = calculateCenterPan(modelPt, zoom, viewWidth, viewHeight);
  // viewWidth / 2 - modelPt.x * zoom = 500 - 300 = 200
  // viewHeight / 2 - modelPt.y * zoom = 300 - 225 = 75
  assert.equal(pan.x, 200);
  assert.equal(pan.y, 75);

  // Verify when rendered:
  const renderedX = modelPt.x * zoom + pan.x;
  const renderedY = modelPt.y * zoom + pan.y;
  assert.equal(renderedX, viewWidth / 2);
  assert.equal(renderedY, viewHeight / 2);
});
