import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_BLOB_PREFIX,
  buildExportBlobName,
  parseExportBlobName,
  bytesToBase64,
  base64ToBytes,
  saveExportToServer,
  listExportHistory,
  downloadExportFromServer,
  deleteExportFromServer,
  keepExportAfterDownload,
} from '../src/export-history-service.js';

test('buildExportBlobName/parseExportBlobName 往返与清洗', () => {
  const name = buildExportBlobName({ kind: 'png', ext: 'png', label: '青 色角色/测试', now: '2026-09-25T12:34:56.000Z' });
  assert.ok(name.startsWith('tl-export/2026-09-25T12:34:56.000Z-png-'));
  assert.ok(name.endsWith('.png'));
  assert.ok(!/[\s/]/.test(name.slice(EXPORT_BLOB_PREFIX.length).replace('tl-export/', '')), '不含空格与斜杠');

  const meta = parseExportBlobName(name);
  assert.equal(meta.at, '2026-09-25T12:34:56.000Z');
  assert.equal(meta.kind, 'png');
  assert.equal(meta.ext, 'png');
  assert.ok(meta.label.includes('青-色角色-测试'));

  // 非 tl-export/ 前缀或形态不符
  assert.equal(parseExportBlobName('other/foo.png'), null);
  assert.equal(parseExportBlobName('tl-export/not-a-date.png'), null);
  assert.equal(parseExportBlobName('tl-export/2026-09-25-png-x.png'), null); // 时间段缺失 → 不符形态
  assert.equal(parseExportBlobName(''), null);
  assert.equal(parseExportBlobName(null), null);
});

test('base64 编解码往返（含中文与二进制字节）', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 228, 184, 173]);
  const b64 = bytesToBase64(bytes);
  const back = base64ToBytes(b64);
  assert.deepEqual([...back], [...bytes]);
  // 大数组（跨 0x8000 分块边界）
  const big = new Uint8Array(0x8000 + 11).map((_, i) => i % 256);
  assert.deepEqual([...base64ToBytes(bytesToBase64(big))], [...big]);
  assert.deepEqual([...base64ToBytes('')], []);
});

function makeBlobClient() {
  const store = new Map();
  let seq = 0;
  const client = {
    storage: {
      blob: {
        put: async input => {
          const id = `blob-${++seq}`;
          const record = { id, name: input.name, contentType: input.contentType ?? '', size: Math.round((input.content.length * 3) / 4), updatedAt: new Date(Date.now() + seq * 1000).toISOString() };
          store.set(id, { record, content: input.content, encoding: input.encoding });
          return record;
        },
        get: async id => {
          const item = store.get(id);
          if (!item) throw new Error('not found');
          return { record: item.record, content: item.content, encoding: 'base64' };
        },
        delete: async id => {
          store.delete(id);
        },
        list: async () => ({ entries: [...store.values()].map(i => i.record) }),
      },
    },
  };
  return { client, store };
}

test('save/list/get/delete 调用形状与过滤排序（桩 client）', async () => {
  const { client, store } = makeBlobClient();
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const saved = await saveExportToServer({ client, name: buildExportBlobName({ kind: 'png', ext: 'png', label: '青', now: '2026-09-25T01:00:00Z' }), bytes, contentType: 'image/png' });
  assert.ok(saved.id);
  // 混入一个非 tl-export/ 的 blob
  store.set('blob-other', { record: { id: 'blob-other', name: 'other/thing.txt', contentType: 'text/plain', size: 9, updatedAt: '2026-09-25T02:00:00Z' }, content: '', encoding: 'utf8' });

  const rows = await listExportHistory({ client });
  assert.equal(rows.length, 1, '前缀过滤');
  assert.equal(rows[0].meta.kind, 'png');

  // 时间倒序：再存一条更晚的
  await saveExportToServer({ client, name: buildExportBlobName({ kind: 'svg', ext: 'svg', label: '青', now: '2026-09-25T03:00:00Z' }), bytes, contentType: 'image/svg+xml' });
  const rows2 = await listExportHistory({ client });
  assert.equal(rows2[0].meta.kind, 'svg');

  const dl = await downloadExportFromServer({ client, id: saved.id });
  assert.deepEqual([...dl.bytes], [...bytes]);
  assert.equal(dl.record.name, saved.name);

  await deleteExportFromServer({ client, id: saved.id });
  const rows3 = await listExportHistory({ client });
  assert.equal(rows3.length, 1);

  // 能力缺失：构造即抛错
  await assert.rejects(() => saveExportToServer({ client: {}, name: 'x', bytes }), /storage\.blob/);
  await assert.rejects(() => listExportHistory({ client: {} }), /storage\.blob/);
});

test('keepExportAfterDownload：开关关闭/Authority 未就绪直接跳过（不触网）', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const off = await keepExportAfterDownload({ blob, filename: 'a.png', label: 'x', getSettings: () => ({ exportServerKeep: false }) });
  assert.deepEqual(off, { saved: false, reason: 'disabled' });

  // getSettings 抛错/缺省 settings 对象 → disabled
  const missing = await keepExportAfterDownload({ blob, filename: 'a.png', getSettings: () => ({}) });
  assert.equal(missing.saved, false);
});
