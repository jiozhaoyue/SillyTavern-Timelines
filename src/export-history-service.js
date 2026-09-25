/**
 * SillyTavern Timelines - Export History Service
 * 导出物服务端留存（Authority storage.blob，可选增强）
 *
 * 职责：
 * 1. 纯函数：blob 命名构建/解析（`tl-export/` 前缀约定）、base64 编解码。
 * 2. IO：saveExportToServer / listExportHistory / downloadExportFromServer / deleteExportFromServer。
 *
 * 数据边界（L1-MF-4）：导出物可从图谱随时全量重建，属派生投影；删除 Authority 数据即重置。
 * 大对象由 SDK blob.put 内部按 inline/transfer 阈值自动分块（shared-types/storage.ts BlobPutRequest）。
 */

/** 服务端留存的 blob 名前缀（约定：仅该前缀视为导出历史） */
export const EXPORT_BLOB_PREFIX = 'tl-export/';

/**
 * 构建导出留存的 blob 名（纯函数）。
 *
 * 形态：`tl-export/<ISO时间戳>-<kind>-<label>.<ext>`
 *
 * @param {object} options
 * @param {string} options.kind - 导出种类（png / svg / gfm ...）。
 * @param {string} options.ext - 文件扩展名。
 * @param {string} [options.label] - 角色名等标签（会清洗掉路径与非法字符）。
 * @param {Date|number|string} [options.now] - 时间（默认当前；测试注入）。
 * @returns {string}
 */
export function buildExportBlobName({ kind, ext, label = '', now = new Date() } = {}) {
  const at = new Date(now);
  const iso = Number.isNaN(at.getTime()) ? new Date(0).toISOString() : at.toISOString();
  const safeLabel = String(label ?? '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const safeKind = String(kind ?? 'export').replace(/[^a-z0-9-]/gi, '') || 'export';
  const safeExt = String(ext ?? 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  return `${EXPORT_BLOB_PREFIX}${iso}-${safeKind}-${safeLabel}.${safeExt}`;
}

/**
 * 解析导出留存的 blob 名（纯函数）；非 `tl-export/` 前缀或形态不符返回 null。
 *
 * 形态契约：`tl-export/<ISO时间戳>-<kind>-<label>.<ext>`
 *
 * @param {string} name
 * @returns {{at: string, kind: string, label: string, ext: string}|null}
 */
export function parseExportBlobName(name) {
  const str = String(name ?? '');
  if (!str.startsWith(EXPORT_BLOB_PREFIX)) return null;
  const rest = str.slice(EXPORT_BLOB_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const base = rest.slice(0, dot);
  const ext = rest.slice(dot + 1);
  // ISO 时间戳自带 '-'（YYYY-MM-DDTHH:mm:ss.sssZ），用锚定前缀的正则而非笼统 split
  const match = base.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([A-Za-z0-9]+)-(.*)$/);
  if (!match) return null;
  return { at: match[1], kind: match[2], label: match[3] ?? '', ext };
}

/**
 * Uint8Array → base64（分块避免大数组 apply 栈溢出；浏览器/Node 通用）。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < source.length; i += CHUNK) {
    binary += String.fromCharCode(...source.subarray(i, i + CHUNK));
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(source).toString('base64');
}

/**
 * base64 → Uint8Array。
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
  const str = String(base64 ?? '');
  if (!str) return new Uint8Array(0);
  if (typeof atob === 'function') {
    const binary = atob(str);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(str, 'base64'));
}

/**
 * 留存导出物到服务端（IO）。
 *
 * @param {object} options
 * @param {object} options.client - Authority client（需具备 storage.blob.put）。
 * @param {string} options.name - blob 名（buildExportBlobName 输出）。
 * @param {Uint8Array} options.bytes - 导出物字节。
 * @param {string} [options.contentType]
 * @returns {Promise<{id: string, name: string, size: number}>} BlobRecord 摘要。
 */
export async function saveExportToServer({ client, name, bytes, contentType = 'application/octet-stream' }) {
  if (!client || typeof client?.storage?.blob?.put !== 'function') {
    throw new Error('Authority client 不具备 storage.blob 能力');
  }
  const record = await client.storage.blob.put({
    name,
    content: bytesToBase64(bytes),
    encoding: 'base64',
    contentType,
  });
  return { id: record?.id ?? '', name: record?.name ?? name, size: Number(record?.size ?? bytes?.length ?? 0) };
}

/**
 * 列出服务端导出历史（IO）：前缀过滤 + updatedAt 倒序 + 解析元数据。
 *
 * @param {object} options
 * @param {object} options.client
 * @returns {Promise<Array<{id: string, name: string, contentType: string, size: number, updatedAt: string, meta: {at: string, kind: string, label: string, ext: string}|null}>>}
 */
export async function listExportHistory({ client }) {
  if (!client || typeof client?.storage?.blob?.list !== 'function') {
    throw new Error('Authority client 不具备 storage.blob 能力');
  }
  const resp = await client.storage.blob.list();
  // SDK 实测返回形态以数组为主（2026-09-25 实证：BlobRecord[] 直返）；容错兼容 {entries} 包装
  const entries = Array.isArray(resp) ? resp : (Array.isArray(resp?.entries) ? resp.entries : []);
  return (Array.isArray(entries) ? entries : [])
    .filter(e => String(e?.name ?? '').startsWith(EXPORT_BLOB_PREFIX))
    .map(e => ({
      id: String(e?.id ?? ''),
      name: String(e?.name ?? ''),
      contentType: String(e?.contentType ?? ''),
      size: Number(e?.size ?? 0),
      updatedAt: String(e?.updatedAt ?? ''),
      meta: parseExportBlobName(e?.name),
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/**
 * 从服务端读取导出物字节（IO）。
 *
 * @param {object} options
 * @param {object} options.client
 * @param {string} options.id - blob id。
 * @returns {Promise<{record: object, bytes: Uint8Array}>}
 */
export async function downloadExportFromServer({ client, id }) {
  if (!client || typeof client?.storage?.blob?.get !== 'function') {
    throw new Error('Authority client 不具备 storage.blob 能力');
  }
  const resp = await client.storage.blob.get(id);
  return { record: resp?.record ?? null, bytes: base64ToBytes(resp?.content) };
}

/**
 * 删除服务端导出物（IO）。
 *
 * @param {object} options
 * @param {object} options.client
 * @param {string} options.id - blob id。
 */
export async function deleteExportFromServer({ client, id }) {
  if (!client || typeof client?.storage?.blob?.delete !== 'function') {
    throw new Error('Authority client 不具备 storage.blob 能力');
  }
  await client.storage.blob.delete(id);
}

/**
 * 导出下载后的留存入口（IO 编排，fire-and-forget 由调用方保证）。
 *
 * 读取宿主设置 `exportServerKeep`（经 Luker/ST context 的 extensionSettings，容错缺省 = 关闭）。
 *
 * @param {object} options
 * @param {Blob} options.blob - 导出产物。
 * @param {string} options.filename - 已格式化的文件名（formatExportFilename 输出）。
 * @param {string} options.label - 角色名等标签（blob 名清洗用）。
 * @param {Function} [options.getSettings] - 测试注入；缺省读宿主 context。
 * @returns {Promise<{saved: boolean, reason?: string, record?: object}>}
 */
export async function keepExportAfterDownload({ blob, filename, label = '', getSettings = null } = {}) {
  const readSettings = () => {
    if (typeof getSettings === 'function') return getSettings() ?? {};
    const ctx =
      (typeof window !== 'undefined' && window.Luker?.getContext?.()) ||
      (typeof window !== 'undefined' && window.SillyTavern?.getContext?.()) ||
      null;
    return ctx?.extensionSettings?.['SillyTavern-Timelines'] ?? {};
  };
  const settings = readSettings();
  if (!settings.exportServerKeep) return { saved: false, reason: 'disabled' };

  const { getAuthorityStatus, getAuthorityClient } = await import('./adapters/authority-adapter.js');
  if (getAuthorityStatus().status !== 'ready') return { saved: false, reason: 'not-ready' };
  const client = await getAuthorityClient();

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const name = buildExportBlobName({ kind: ext, ext, label, now: new Date() });
  const contentType = blob.type || 'application/octet-stream';
  const record = await saveExportToServer({ client, name, bytes, contentType });
  return { saved: true, record };
}
