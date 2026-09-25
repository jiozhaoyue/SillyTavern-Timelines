/**
 * SillyTavern Timelines - Export History Modal
 * 服务端导出历史画廊（Authority storage.blob 可选增强）
 *
 * 展示 `tl-export/` 前缀的留存导出物（时间倒序），支持重新下载与删除。
 * DOM 模块：`typeof document === 'undefined'` 时安全短路（spec Node 可测约定）。
 */

import { listExportHistory, downloadExportFromServer, deleteExportFromServer } from './export-history-service.js';
import { getAuthorityStatus, getAuthorityClient } from './adapters/authority-adapter.js';
import { escapeHtml } from './helpers.js';

const MODAL_ID = 'timelines-export-history-modal';

/**
 * 关闭导出历史弹窗。
 */
export function closeExportHistoryModal() {
  document.getElementById(MODAL_ID)?.remove();
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

/**
 * 打开导出历史弹窗（异步加载列表；Authority 未就绪/失败时提示）。
 */
export async function openExportHistoryModal() {
  if (typeof document === 'undefined') return;
  closeExportHistoryModal();

  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'timelines-export-history-modal';
  modal.innerHTML = `
    <div class="timelines-export-history-inner">
      <div class="export-history-header">
        <h3><i class="fa-solid fa-clock-rotate-left"></i> 服务端导出历史</h3>
        <span class="export-history-count">加载中…</span>
        <button class="menu_button export-history-close-btn">✕</button>
      </div>
      <div class="export-history-body"><div class="export-history-empty">正在读取…</div></div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.export-history-close-btn').addEventListener('click', close);
  modal.addEventListener('click', e => {
    if (e.target === modal) close();
  });

  const renderRows = rows =>
    rows.length
      ? rows
          .map(
            row => `
        <div class="export-history-card" data-id="${escapeAttr(row.id)}">
          <div class="export-history-main">
            <span class="export-history-name" title="${escapeAttr(row.name)}">${escapeHtml(row.meta?.label || row.name)}</span>
            <span class="export-history-meta">${escapeHtml(row.meta ? `${row.meta.kind.toUpperCase()} · ${row.meta.at}` : row.updatedAt)} · ${formatSize(row.size)}</span>
          </div>
          <div class="export-history-actions">
            <button class="menu_button export-history-dl-btn" title="从服务端下载此导出物">⬇ 下载</button>
            <button class="menu_button export-history-del-btn" title="从服务端删除此导出物">🗑</button>
          </div>
        </div>`,
          )
          .join('')
      : '<div class="export-history-empty">暂无服务端留存的导出物。</div>';

  const bindActions = () => {
    modal.querySelectorAll('.export-history-dl-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.export-history-card')?.dataset?.id;
        if (!id) return;
        btn.disabled = true;
        try {
          const client = await getAuthorityClient();
          const { record, bytes } = await downloadExportFromServer({ client, id });
          const blob = new Blob([bytes], { type: record?.contentType || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = record?.name?.split('/').pop() || 'timeline-export';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          toastr.success('已从服务端下载导出物');
        } catch (err) {
          console.error('[Export History] 下载失败:', err);
          toastr.error(`下载失败: ${err?.message ?? err}`);
        } finally {
          btn.disabled = false;
        }
      });
    });
    modal.querySelectorAll('.export-history-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.export-history-card')?.dataset?.id;
        if (!id) return;
        btn.disabled = true;
        try {
          const client = await getAuthorityClient();
          await deleteExportFromServer({ client, id });
          btn.closest('.export-history-card')?.remove();
          toastr.success('已从服务端删除');
        } catch (err) {
          console.error('[Export History] 删除失败:', err);
          toastr.error(`删除失败: ${err?.message ?? err}`);
          btn.disabled = false;
        }
      });
    });
  };

  try {
    if (getAuthorityStatus().status !== 'ready') {
      modal.querySelector('.export-history-count').textContent = '未就绪';
      modal.querySelector('.export-history-body').innerHTML =
        '<div class="export-history-empty">Authority 未就绪，无法读取导出历史。</div>';
      return;
    }
    const client = await getAuthorityClient();
    const rows = await listExportHistory({ client });
    modal.querySelector('.export-history-count').textContent = `${rows.length} 份`;
    modal.querySelector('.export-history-body').innerHTML = renderRows(rows);
    bindActions();
  } catch (err) {
    console.error('[Export History] 读取失败:', err);
    modal.querySelector('.export-history-count').textContent = '读取失败';
    modal.querySelector('.export-history-body').innerHTML =
      `<div class="export-history-empty">读取失败: ${escapeHtml(String(err?.message ?? err))}</div>`;
  }
}
