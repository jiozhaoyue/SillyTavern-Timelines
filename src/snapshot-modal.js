/**
 * SillyTavern Timelines - Snapshot Modal
 * 分支检查点快照与时光机存档管理交互弹窗
 * 
 * 职责：
 * 1. 弹出时光机归档画廊（暗色高斯毛玻璃、时间轴卡片流）。
 * 2. 实时检索与过滤快照卡片。
 * 3. 视口聚焦与呼吸脉冲联动。
 * 4. 原生时空穿越：利用 openCharacterChat 跨分支会话无缝切换与定位。
 * 5. 导出 Markdown 存档清单。
 */

import {
  extractTimelineSnapshots,
  filterSnapshots,
  formatSnapshotsMarkdown,
} from './snapshot-service.js';
import { navigateToMessage } from './utils.js';

let activeSnapshotModal = null;

/**
 * 触发下载文本文件
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * 打开时光机快照画廊
 * @param {object} cy Cytoscape 实例
 * @param {object} context 酒馆上下文
 */
export function openSnapshotGalleryModal(cy, context = {}) {
  closeSnapshotGalleryModal();

  const allSnapshots = extractTimelineSnapshots(cy);
  let displayedSnapshots = [...allSnapshots];

  const backdrop = document.createElement('div');
  backdrop.className = 'timelines-snapshot-backdrop';

  const modal = document.createElement('div');
  modal.className = 'timelines-snapshot-dialog';

  modal.innerHTML = `
    <div class="snapshot-header">
      <div class="snapshot-title-group">
        <div class="snapshot-title">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <span>时光机存档画廊与分支检查点</span>
        </div>
        <div class="snapshot-subtitle">关键分歧剧情快照 · 节点视口极速跳跃 · 跨分支会话时空穿越</div>
      </div>
      <button class="snapshot-close-btn" title="关闭"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <!-- 顶部搜索工具条 -->
    <div class="snapshot-toolbar">
      <div class="snapshot-search-box">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" class="snapshot-search-input" placeholder="检索快照标题、台词、角色、标签或楼层..." />
      </div>
      <div class="snapshot-summary-badge">
        <span class="count-val">${displayedSnapshots.length}</span> 个关键剧情存档点
      </div>
    </div>

    <!-- 时间轴快照卡片流 -->
    <div class="snapshot-body">
      <div class="snapshot-timeline-stream"></div>
    </div>

    <div class="snapshot-footer">
      <div class="footer-status">
        <span class="status-indicator">●</span> 已按楼层时间线升序排列关键存档点
      </div>
      <div class="footer-actions">
        <button class="snapshot-btn secondary btn-copy-md" title="复制 Markdown 存档清单">
          <i class="fa-solid fa-copy"></i> 复制 Markdown
        </button>
        <button class="snapshot-btn secondary btn-dl-md" title="下载 Markdown 清单">
          <i class="fa-solid fa-download"></i> 导出清单
        </button>
        <button class="snapshot-btn primary btn-close">
          关闭
        </button>
      </div>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  activeSnapshotModal = backdrop;

  const streamContainer = modal.querySelector('.snapshot-timeline-stream');
  const searchInput = modal.querySelector('.snapshot-search-input');
  const countVal = modal.querySelector('.count-val');
  const closeBtn = modal.querySelector('.snapshot-close-btn');
  const btnCloseBottom = modal.querySelector('.btn-close');
  const btnCopyMd = modal.querySelector('.btn-copy-md');
  const btnDlMd = modal.querySelector('.btn-dl-md');

  // 渲染卡片列表
  const renderList = (items) => {
    if (!items || items.length === 0) {
      streamContainer.innerHTML = `
        <div class="snapshot-empty-state">
          <i class="fa-solid fa-ghost"></i>
          <div>未找到匹配的剧情快照点</div>
          <div class="sub-hint">尝试更换搜索词，或在时间树节点右键添加书签与标签。</div>
        </div>
      `;
      countVal.textContent = '0';
      return;
    }

    countVal.textContent = String(items.length);
    streamContainer.innerHTML = items.map((s, idx) => {
      const roleClass = s.is_user ? 'is-user' : 'is-character';
      const roleName = s.is_user ? 'User' : s.speaker;
      const tagsPills = s.tags.map(t => `<span class="snapshot-tag" style="border-color:${t.color}66; color:${t.color}"><i class="fa-solid fa-tag"></i> #${t.name}</span>`).join('');
      const branchBadge = s.chatFile ? `<span class="snapshot-branch-badge" title="所属分支"><i class="fa-solid fa-code-branch"></i> ${s.chatFile}</span>` : '';

      return `
        <div class="snapshot-card ${roleClass}" data-node-id="${s.nodeId}" data-floor="${s.messageId}" data-chat="${s.chatFile || ''}">
          <div class="card-rail">
            <div class="rail-point"></div>
          </div>
          <div class="card-content">
            <div class="card-header">
              <span class="floor-badge">#${s.messageId} 楼</span>
              <span class="role-badge">${roleName}</span>
              ${branchBadge}
              ${s.isBookmark ? '<span class="bookmark-icon" title="书签"><i class="fa-solid fa-star"></i></span>' : ''}
              ${s.isBranchPoint ? `<span class="branch-point-icon" title="剧情分流 (${s.outDegree} 分支)"><i class="fa-solid fa-shuffle"></i></span>` : ''}
              <div class="card-actions">
                <button class="action-btn btn-focus-node" title="在拓扑图中聚焦该节点"><i class="fa-solid fa-crosshairs"></i> 定位</button>
                ${s.chatFile ? '<button class="action-btn btn-teleport-chat" title="切换酒馆至该分支会话"><i class="fa-solid fa-paper-plane"></i> 穿越</button>' : ''}
              </div>
            </div>

            <div class="card-title">${s.title}</div>
            <div class="card-text">${s.previewText}</div>
            ${tagsPills ? `<div class="card-tags">${tagsPills}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // 绑定卡片交互事件
    streamContainer.querySelectorAll('.snapshot-card').forEach(card => {
      const nodeId = card.getAttribute('data-node-id');
      const floor = Number(card.getAttribute('data-floor') || 0);
      const chatFile = card.getAttribute('data-chat');

      // 定位视口
      const btnFocus = card.querySelector('.btn-focus-node');
      const focusHandler = () => {
        if (!cy) return;
        const targetNode = cy.getElementById(nodeId);
        if (targetNode && targetNode.length > 0) {
          closeSnapshotGalleryModal();
          cy.stop().animate({
            center: { eles: targetNode },
            zoom: Math.max(cy.zoom(), 1.0),
            duration: 400,
          });
          targetNode.flashClass('timelines-node-pulse', 2500);
        } else {
          toastr.info(`该节点位于分支 ${chatFile || '其它会话'} 中`);
        }
      };

      if (btnFocus) btnFocus.addEventListener('click', (e) => {
        e.stopPropagation();
        focusHandler();
      });

      // 穿越到该分支
      const btnTeleport = card.querySelector('.btn-teleport-chat');
      if (btnTeleport) {
        btnTeleport.addEventListener('click', async (e) => {
          e.stopPropagation();
          closeSnapshotGalleryModal();
          try {
            if (typeof window.SillyTavern !== 'undefined' && window.SillyTavern.getContext) {
              const tavernCtx = window.SillyTavern.getContext();
              if (chatFile && tavernCtx.chatId !== chatFile && typeof tavernCtx.openCharacterChat === 'function') {
                toastr.info(`正在穿越至分支会话: ${chatFile}...`);
                await tavernCtx.openCharacterChat(chatFile);
              }
            }
            // 滚动到该楼层
            setTimeout(() => {
              navigateToMessage(floor);
            }, 600);
          } catch (err) {
            console.error('[Timelines Snapshot] 切换分支失败:', err);
            toastr.error('切换会话分支失败');
          }
        });
      }

      // 点击卡片本身聚焦
      card.addEventListener('click', () => {
        focusHandler();
      });
    });
  };

  renderList(displayedSnapshots);

  // 搜索事件
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    displayedSnapshots = filterSnapshots(allSnapshots, q);
    renderList(displayedSnapshots);
  });

  // 关闭
  const closeHandler = () => closeSnapshotGalleryModal();
  closeBtn.addEventListener('click', closeHandler);
  btnCloseBottom.addEventListener('click', closeHandler);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSnapshotGalleryModal();
  });

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      closeSnapshotGalleryModal();
      document.removeEventListener('keydown', onKeydown);
    }
  };
  document.addEventListener('keydown', onKeydown);

  // 复制 Markdown
  btnCopyMd.addEventListener('click', async () => {
    const md = formatSnapshotsMarkdown(displayedSnapshots, context);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(md);
      } else {
        const ta = document.createElement('textarea');
        ta.value = md;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      btnCopyMd.innerHTML = '<i class="fa-solid fa-check"></i> 已复制清单';
      setTimeout(() => {
        btnCopyMd.innerHTML = '<i class="fa-solid fa-copy"></i> 复制 Markdown';
      }, 2000);
    } catch (err) {
      console.error('[Timelines Snapshot] 复制失败:', err);
    }
  });

  // 下载 Markdown
  btnDlMd.addEventListener('click', () => {
    const md = formatSnapshotsMarkdown(displayedSnapshots, context);
    const filename = `timeline-snapshots-${Date.now()}.md`;
    downloadFile(md, filename, 'text/markdown;charset=utf-8');
  });
}

/**
 * 关闭时光机快照画廊
 */
export function closeSnapshotGalleryModal() {
  if (activeSnapshotModal) {
    try {
      activeSnapshotModal.remove();
    } catch {
      // ignore
    }
    activeSnapshotModal = null;
  }
}
