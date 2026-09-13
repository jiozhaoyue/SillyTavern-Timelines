import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDeviceProfile,
  truncateForNode,
  MIN_PREVIEW_CHARS,
  MOBILE_PREVIEW_CHARS,
  DESKTOP_PREVIEW_CHARS,
  MOBILE_FETCH_CONCURRENCY,
  DESKTOP_FETCH_CONCURRENCY,
} from '../src/memory-profile.js';

const strongNav = { deviceMemory: 8, hardwareConcurrency: 8, maxTouchPoints: 0 };
const weakNav = { deviceMemory: 2, hardwareConcurrency: 4, maxTouchPoints: 5 };
const touchNav = { deviceMemory: 8, hardwareConcurrency: 8, maxTouchPoints: 5 };

test('detectDeviceProfile auto mode distinguishes weak and strong devices', () => {
  const weak = detectDeviceProfile({ navigatorOverride: weakNav, mode: 'auto' });
  assert.equal(weak.memorySaver, true);
  assert.equal(weak.maxPreviewChars, MOBILE_PREVIEW_CHARS); // 弱设备用移动预览长度
  assert.equal(weak.fetchConcurrency, MOBILE_FETCH_CONCURRENCY);
  assert.match(weak.reason, /自动开启/);

  const strong = detectDeviceProfile({ navigatorOverride: strongNav, mode: 'auto' });
  assert.equal(strong.memorySaver, false);
  assert.equal(strong.maxPreviewChars, 0); // 不截断 = 保持旧行为
  assert.equal(strong.fetchConcurrency, DESKTOP_FETCH_CONCURRENCY);

  // 触屏设备即使内存充足也按移动画像处理
  const touch = detectDeviceProfile({ navigatorOverride: touchNav, mode: 'auto' });
  assert.equal(touch.memorySaver, true);
});

test('detectDeviceProfile honors forced on/off over device signals', () => {
  const forcedOn = detectDeviceProfile({ navigatorOverride: strongNav, mode: 'on' });
  assert.equal(forcedOn.memorySaver, true);
  assert.equal(forcedOn.maxPreviewChars, DESKTOP_PREVIEW_CHARS);

  const forcedOff = detectDeviceProfile({ navigatorOverride: weakNav, mode: 'off' });
  assert.equal(forcedOff.memorySaver, false);
  assert.equal(forcedOff.maxPreviewChars, 0);

  // 无 navigator 环境（Node）auto 不误报弱设备
  const noNav = detectDeviceProfile({ navigatorOverride: null, mode: 'auto' });
  assert.equal(noNav.memorySaver, false);
});

test('truncateForNode truncates with ellipsis and boundary safety', () => {
  // 未超限不截断
  assert.deepEqual(truncateForNode('短文本', 240), { text: '短文本', truncated: false });

  // 恰好等于限制不截断
  const exact = 'a'.repeat(160);
  assert.deepEqual(truncateForNode(exact, 160), { text: exact, truncated: false });

  // 超限截断加省略号
  const over = truncateForNode('龙'.repeat(200), 160);
  assert.equal(over.truncated, true);
  assert.equal(over.text.length, MOBILE_PREVIEW_CHARS + 3);
  assert.ok(over.text.endsWith('...'));

  // 下限钳制
  const clamped = truncateForNode('b'.repeat(1000), 5);
  assert.equal(clamped.text.length, MIN_PREVIEW_CHARS + 3);

  // null / 空串安全
  assert.deepEqual(truncateForNode(null, 160), { text: '', truncated: false });
  assert.deepEqual(truncateForNode('', 160), { text: '', truncated: false });
});
