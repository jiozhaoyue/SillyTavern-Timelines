/**
 * SillyTavern Timelines - Semantic Global Modal
 * 跨会话语义检索结果弹窗
 *
 * 展示 Authority 语义检索中无法映射进当前内存图谱的命中项（其他分支会话），
 * 并提供「穿越」按钮：复用原生 openCharacterChat 调度器切换会话并定位楼层
 * （navigateToMessage 内部已处理会话切换与滚动，见 src/utils.js）。
 */

import { navigateToMessage } from './utils.js';
import { escapeHtml } from './helpers.js';
import { groupGlobalResultsByNamespace } from './semantic-search-service.js';

/** 弹窗 DOM id 常量 */
const MODAL_ID = 'timelines-semantic-global-modal';

/**
 * 关闭跨会话语义结果弹窗。
 */
export function closeSemanticGlobalModal() {
  document.getElementById(MODAL_ID)?.remove();
}

/**
 * 渲染单张结果卡（纯字符串；来源徽标 / 上下文芯片 / 书签与标签）。
 *
 * @param {object} row - formatGlobalResults 输出行（可含 namespace/namespaceLabel/context）。
 * @returns {string} HTML。
 */
function renderResultCard(row) {
  const contextChips = Array.isArray(row.context)
    ? row.context
        .map(
          ref => `<button class="semantic-context-chip" data-chat-file="${escapeHtml(ref.chatFile)}" data-message-id="${escapeHtml(ref.messageId)}" title="跳转到相邻楼层">↳ ${escapeHtml(ref.chatFile)} · 第 ${escapeHtml(ref.messageId)} 楼</button>`,
        )
        .join('')
    : '';
  const sourceBadge = row.namespace
    ? `<span class="semantic-source-badge">📦 ${escapeHtml(row.namespaceLabel || row.namespace)}</span>`
    : '';
  return `
        <div class="semantic-result-card" data-chat-file="${escapeHtml(row.chatFile)}" data-message-id="${escapeHtml(row.messageId)}">
          <div class="semantic-result-header">
            <span class="semantic-result-speaker ${row.is_user ? 'is-user' : 'is-char'}">${escapeHtml(row.name || (row.is_user ? 'User' : 'Character'))}</span>
            <span class="semantic-result-meta">🌐 ${escapeHtml(row.chatFile)} · 第 ${escapeHtml(row.messageId)} 楼</span>
            <span class="semantic-result-score">${(Number(row.score) || 0).toFixed(3)}</span>
          </div>
          <div class="semantic-result-preview">${escapeHtml(row.preview)}</div>
          <div class="semantic-result-footer">
            ${sourceBadge}
            ${row.bookmark ? '<span class="semantic-result-badge">⭐ 书签</span>' : ''}
            ${row.tags.map(t => `<span class="semantic-result-badge">🏷️ ${escapeHtml(t)}</span>`).join('')}
            <button class="menu_button semantic-jump-btn" title="切换到该分支会话并定位到此楼层">🚀 穿越</button>
          </div>
          ${contextChips ? `<div class="semantic-result-context">${contextChips}</div>` : ''}
        </div>`;
}

/**
 * 打开跨会话语义检索结果弹窗。
 *
 * @param {Array<{chatFile: string, messageId: number, name: string, is_user: boolean, preview: string, score: number, tags: Array<string>, bookmark: boolean, namespace?: string|null, namespaceLabel?: string|null, context?: Array<{chatFile: string, messageId: string}>}>} results
 *   formatGlobalResults 的输出（Phase 1 起可携带来源 namespace 与邻居上下文）。
 * @param {object} [context]
 * @param {string} [context.query] - 触发检索的查询文本（标题展示）。
 * @param {boolean} [context.groupByNamespace] - 按来源 namespace 分组展示（跨角色全局检索）。
 */
export function openSemanticGlobalModal(results, context = {}) {
  if (typeof document === 'undefined') return;
  closeSemanticGlobalModal();

  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'timelines-semantic-modal';

  const rows = Array.isArray(results) ? results : [];
  const queryText = context.query ? String(context.query) : '';

  const renderGroup = (groupRows, groupHeader = '') =>
    `${groupHeader}${groupRows.map(renderResultCard).join('')}`;

  let itemsHtml;
  if (rows.length === 0) {
    itemsHtml = '<div class="semantic-result-empty">未找到可穿越的跨会话结果。</div>';
  } else if (context.groupByNamespace) {
    itemsHtml = groupGlobalResultsByNamespace(rows)
      .map(group => renderGroup(group.rows, `<div class="semantic-group-header">📦 ${escapeHtml(group.label)} <span class="semantic-group-count">${group.rows.length} 条</span></div>`))
      .join('');
  } else {
    itemsHtml = renderGroup(rows);
  }

  modal.innerHTML = `
    <div class="timelines-semantic-modal-inner">
      <div class="timelines-semantic-modal-header">
        <h3>🌐 跨会话语义检索结果${queryText ? `<span class="semantic-query-hint">「${escapeHtml(queryText)}」</span>` : ''}</h3>
        <span class="semantic-result-count">${rows.length} 条</span>
        <button class="menu_button semantic-close-btn">✕</button>
      </div>
      <div class="timelines-semantic-modal-body">${itemsHtml}</div>
    </div>
  `;

  // 关闭
  modal.querySelector('.semantic-close-btn').addEventListener('click', () => closeSemanticGlobalModal());
  modal.addEventListener('click', e => {
    if (e.target === modal) closeSemanticGlobalModal();
  });

  // 穿越：navigateToMessage 内部会 openCharacterChat 并滚动定位
  modal.querySelectorAll('.semantic-jump-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const card = btn.closest('.semantic-result-card');
      const chatFile = card?.dataset.chatFile;
      const messageId = card?.dataset.messageId;
      if (!chatFile || messageId == null) return;
      closeSemanticGlobalModal();
      try {
        toastr.info(`正在穿越至分支会话: ${chatFile} 第 ${messageId} 楼...`);
        await navigateToMessage(chatFile, messageId);
      } catch (err) {
        console.error('[Timelines Semantic] 跨会话穿越失败:', err);
        toastr.error('切换会话分支失败');
      }
    });
  });

  // 上下文芯片：跳转到相邻楼层（与穿越同一原生调度）
  modal.querySelectorAll('.semantic-context-chip').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const chatFile = btn.dataset.chatFile;
      const messageId = btn.dataset.messageId;
      if (!chatFile || messageId === '' || messageId == null) return;
      closeSemanticGlobalModal();
      try {
        toastr.info(`正在跳转到相邻楼层: ${chatFile} 第 ${messageId} 楼...`);
        await navigateToMessage(chatFile, messageId);
      } catch (err) {
        console.error('[Timelines Semantic] 相邻楼层跳转失败:', err);
        toastr.error('跳转相邻楼层失败');
      }
    });
  });

  document.body.appendChild(modal);
}
