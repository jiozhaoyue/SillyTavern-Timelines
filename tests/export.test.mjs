import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSafeScale,
  formatExportFilename,
} from '../src/export-service.js';

test('calculateSafeScale respects normal targets without exceeding max dimension', () => {
  // 1000x800 图谱，2x 采样 -> 2000x1600 <= 8192
  const scale1 = calculateSafeScale(1000, 800, 2.0, 8192);
  assert.equal(scale1, 2.0);

  // 1000x800 图谱，4x 采样 -> 4000x3200 <= 8192
  const scale2 = calculateSafeScale(1000, 800, 4.0, 8192);
  assert.equal(scale2, 4.0);
});

test('calculateSafeScale clamps scale when graph dimensions exceed max dimension', () => {
  // 超大树 5000x4000，请求 2x -> 10000 > 8192，应被压缩到 8192 / 5000 = 1.6384
  const scale = calculateSafeScale(5000, 4000, 2.0, 8192);
  assert.equal(scale, 8192 / 5000);
  assert.ok(5000 * scale <= 8192);
  assert.ok(4000 * scale <= 8192);
});

test('calculateSafeScale handles extreme or zero inputs gracefully', () => {
  assert.equal(calculateSafeScale(0, 0, 2.0), 2.0);
  assert.equal(calculateSafeScale(-100, -200, 1.5), 1.5);
  assert.equal(calculateSafeScale(1000, 1000, -5), 0.1); // 最低保留 0.1
});

test('formatExportFilename creates clean, timestamped filenames', () => {
  const name1 = formatExportFilename('艾莉亚 Aria', 'png');
  assert.ok(name1.startsWith('Timelines_艾莉亚_Aria_'));
  assert.ok(name1.endsWith('.png'));

  const name2 = formatExportFilename('Test/Slash:Special*', 'svg');
  assert.ok(name2.startsWith('Timelines_Test_Slash_Special_'));
  assert.ok(name2.endsWith('.svg'));
});

test('exportTimelineAsSvg serializes graph elements into valid SVG Blob', async () => {
  const { exportTimelineAsSvg } = await import('../src/export-service.js');

  const mockCy = {
    elements: () => ({
      boundingBox: () => ({ x1: 10, y1: 20, w: 200, h: 300 }),
    }),
    nodes: () => [
      {
        position: () => ({ x: 50, y: 60 }),
        width: () => 40,
        height: () => 40,
        style: prop => prop === 'shape' ? 'ellipse' : '#ffffff',
        data: prop => prop === 'label' ? '第 1 轮对话' : '',
      },
      {
        position: () => ({ x: 50, y: 150 }),
        width: () => 40,
        height: () => 40,
        style: prop => prop === 'shape' ? 'round-rectangle' : '#3b82f6',
        data: prop => prop === 'label' ? '第 2 轮分支' : '',
      },
    ],
    edges: () => [
      {
        source: () => ({ position: () => ({ x: 50, y: 60 }) }),
        target: () => ({ position: () => ({ x: 50, y: 150 }) }),
        style: prop => prop === 'line-color' ? '#555555' : '2px',
      },
    ],
  };

  const blob = exportTimelineAsSvg(mockCy, { bg: '#0d1117' });
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'image/svg+xml;charset=utf-8');

  const text = await blob.text();
  assert.ok(text.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(text.includes('<ellipse cx="50" cy="60"'));
  assert.ok(text.includes('<rect x="30" y="130"'));
  assert.ok(text.includes('<line x1="50" y1="60" x2="50" y2="150"'));
  assert.ok(text.includes('第 1 轮对话'));
});

