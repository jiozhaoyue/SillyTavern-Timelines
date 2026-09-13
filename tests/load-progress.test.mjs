import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProgressState,
  formatProgressLabel,
  PROGRESS_PHASES,
} from '../src/load-progress.js';

test('progress state computes phase-weighted percentages within bounds', () => {
  const ps = createProgressState();

  // list 阶段：权重 5，无计数 → 仅前置权重 0，innerRatio 0 → 0
  ps.set('list', { done: 0, total: 1 });
  assert.equal(ps.get().percent, 0);

  // list 完成 → 5（list 权重全部计入）
  ps.set('list', { done: 1, total: 1 });
  assert.equal(ps.get().percent, 5);

  // data 阶段 12/40 → 5 + (12/40)*60 = 23
  ps.set('data', { done: 12, total: 40, detail: 'branch-a.jsonl' });
  assert.equal(ps.get().percent, 23);

  // data 完成 → 5 + 60 = 65
  ps.set('data', { done: 40, total: 40 });
  assert.equal(ps.get().percent, 65);

  // build 阶段一半 → 65 + 0.5*15 = 72.5
  ps.set('build', { done: 1, total: 2 });
  assert.equal(ps.get().percent, 72.5);

  // layout 完成（未 done）→ 80 + 15 = 95（未到 done 前 99 封顶不触发）
  ps.set('layout', { done: 1, total: 1 });
  assert.equal(ps.get().percent, 95);

  // done → 100
  ps.done();
  assert.equal(ps.get().percent, 100);
  assert.equal(ps.get().status, 'done');

  // 终态后 set 被忽略
  ps.set('list', { done: 1, total: 1 });
  assert.equal(ps.get().percent, 100);
});

test('progress state percent is monotonic and never regresses', () => {
  const ps = createProgressState();
  ps.set('data', { done: 30, total: 40 }); // 50
  assert.equal(ps.get().percent, 50);

  // 乱序回到 list（0%）时视觉进度不回退，但信息仍更新
  const state = ps.set('list', { done: 0, total: 1 });
  assert.equal(state.percent, 50);
  assert.equal(state.phase, 'list');
  assert.equal(ps.get().percent, 50);

  // 超界钳位
  ps.set('data', { done: 999, total: 40 });
  assert.ok(ps.get().percent <= 99);
});

test('progress state supports failure terminal state and subscriptions', () => {
  const ps = createProgressState();
  const seen = [];
  const unsub = ps.subscribe(s => seen.push(s.status));

  ps.set('data', { done: 1, total: 10 });
  ps.fail(new Error('网络超时'));

  const final = ps.get();
  assert.equal(final.status, 'failed');
  assert.equal(final.error, '网络超时');
  assert.deepEqual(seen, ['running', 'failed']);

  unsub();
  ps.done();
  assert.equal(ps.get().status, 'failed'); // 失败是终态
});

test('formatProgressLabel renders phase, counts and detail', () => {
  const ps = createProgressState();
  assert.equal(formatProgressLabel(ps.get()), '准备中...');

  ps.set('data', { done: 12, total: 40, detail: 'branch-a.jsonl' });
  assert.equal(formatProgressLabel(ps.get()), `${PROGRESS_PHASES.data.label} (12/40)：branch-a.jsonl`);

  ps.done();
  assert.equal(formatProgressLabel(ps.get()), '时间线就绪');

  const failed = createProgressState();
  failed.fail('拒绝授权');
  assert.equal(formatProgressLabel(failed.get()), '加载失败：拒绝授权');

  // 未知阶段兜底
  assert.equal(formatProgressLabel({ status: 'running', phase: 'bogus' }), '处理中');
});
