/**
 * @file diff-modal.js
 * 渲染多分支差异对比浮层 (Diff Modal)。
 * 展示两分支在 LCA 最近公共祖先分叉点之后的走向，支持单消息采摘 (Cherry-Pick) 与基于 LCA 的双分支合并派生。
 */

import { openCharacterChat } from '../../../../../script.js';
import { createBranch } from '../../../../bookmarks.js';
import { escapeHtml } from '../../../../utils.js';
import {
  cherryPickMessageToCurrentChat,
  synthesizeMergedChatSequence,
  generateMergeBranchName,
} from './merge-service.js';

let diffModalElement = null;

function ensureDiffModal() {
  if (diffModalElement && document.body.contains(diffModalElement)) {
    return diffModalElement;
  }

  const html = `
    <div id="timelinesDiffModal" class="timelines-diff-backdrop hidden">
        <div class="timelines-diff-dialog">
            <div class="timelines-diff-header">
                <div class="timelines-diff-title">
                    <span class="fa-solid fa-code-branch" style="color: #38bdf8;"></span>
                    <span id="diffModalTitle">分支差异对比与合并 (Diff & Merge)</span>
                </div>
                <div class="timelines-diff-actions">
                    <button id="mergeBranchesBtn" class="menu_button tl-merge-branches-btn" title="以分叉点 LCA 为底，合并两分支剧情派生新分支">
                        <i class="fa-solid fa-code-merge"></i> 合并两分支为新会话
                    </button>
                    <button id="closeDiffModalBtn" class="fa-solid fa-xmark timelines-diff-close" title="关闭对比窗口"></button>
                </div>
            </div>
            <div id="diffLcaSummary" class="timelines-diff-lca">
                <!-- LCA 分叉点摘要由 JS 动态填充 -->
            </div>
            <div id="diffStatsBar" class="timelines-diff-stats">
                <!-- 分支统计指标栏由 JS 动态填充 -->
            </div>
            <div class="timelines-diff-body">
                <div class="timelines-diff-column" id="diffColumnA">
                    <div class="timelines-diff-col-header" id="diffColHeaderA">
                        <span class="col-badge" id="colBadgeA">分支 A</span>
                        <span class="col-name" id="diffColNameA"></span>
                        <button class="menu_button switch-branch-btn" id="switchBranchBtnA" title="切换并进入此分支">进入此分支</button>
                    </div>
                    <div class="timelines-diff-message-list" id="diffMsgListA"></div>
                </div>
                <div class="timelines-diff-column" id="diffColumnB">
                    <div class="timelines-diff-col-header" id="diffColHeaderB">
                        <span class="col-badge" id="colBadgeB">分支 B</span>
                        <span class="col-name" id="diffColNameB"></span>
                        <button class="menu_button switch-branch-btn" id="switchBranchBtnB" title="切换并进入此分支">进入此分支</button>
                    </div>
                    <div class="timelines-diff-message-list" id="diffMsgListB"></div>
                </div>
            </div>
        </div>
    </div>
    `;

  const template = document.createElement('div');
  template.innerHTML = html.trim();
  diffModalElement = template.firstChild;
  document.body.appendChild(diffModalElement);

  diffModalElement.querySelector('#closeDiffModalBtn').addEventListener('click', () => {
    closeDiffModal();
  });

  diffModalElement.addEventListener('click', evt => {
    if (evt.target === diffModalElement) {
      closeDiffModal();
    }
  });

  return diffModalElement;
}

/**
 * 格式化渲染单侧消息卡片列表并绑定采摘动作
 *
 * @param {HTMLElement} containerElement
 * @param {Array} diffList
 * @param {boolean} isCurrentBranch - 该侧是否为当前活动分支
 */
function renderMessageCards(containerElement, diffList, isCurrentBranch) {
  containerElement.innerHTML = '';
  if (!Array.isArray(diffList) || diffList.length === 0) {
    containerElement.innerHTML = '<div class="timelines-diff-empty">此分支在分叉点后没有额外消息。</div>';
    return;
  }

  diffList.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `timelines-diff-card ${item.isUser ? 'is-user' : 'is-character'}`;

    const roleName = escapeHtml(item.name || (item.isUser ? 'User' : 'AI'));
    const textContent = escapeHtml(item.msg || '');
    const floorText = item.messageId !== undefined ? `#${item.messageId}` : `+${index + 1}`;
    const swipeBadge =
      item.totalSwipes > 1 ? `<span class="swipe-badge">Swipe ${item.swipeId + 1}/${item.totalSwipes}</span>` : '';

    card.innerHTML = `
      <div class="card-meta">
        <span class="sender-name">${roleName}</span>
        <span class="floor-badge">${floorText}</span>
        ${swipeBadge}
      </div>
      <div class="card-text">${textContent}</div>
      <div class="card-actions">
        <button class="tl-cherry-pick-btn" title="将此消息复制并追加至当前活动会话">
          <i class="fa-solid fa-seedling"></i> 采摘至当前会话
        </button>
      </div>
    `;

    // 绑定单消息采摘动作
    const pickBtn = card.querySelector('.tl-cherry-pick-btn');
    pickBtn.onclick = async () => {
      pickBtn.disabled = true;
      pickBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 采摘中...';

      const res = await cherryPickMessageToCurrentChat(item);
      if (res.success) {
        pickBtn.classList.add('picked');
        pickBtn.innerHTML = '<i class="fa-solid fa-check"></i> 已采摘到末尾';
        toastr.success(`已成功采摘消息至当前会话（第 ${res.index} 楼）`);
      } else {
        pickBtn.disabled = false;
        pickBtn.innerHTML = '<i class="fa-solid fa-seedling"></i> 采摘至当前会话';
        toastr.error(`采摘失败: ${res.error || '未知错误'}`);
      }
    };

    containerElement.appendChild(card);
  });
}

/**
 * 打开并展示多分支差异对比模态框
 *
 * @param {Object} diffResult - computeBranchLCA 返回的差异对象
 * @param {string} [nameA='分支 A']
 * @param {string} [nameB='分支 B']
 * @param {Object} [options={}]
 * @param {Function} [options.onReload]
 */
export function showDiffModal(diffResult, nameA = '分支 A', nameB = '分支 B', { onReload } = {}) {
  const modal = ensureDiffModal();

  const ctx = typeof window !== 'undefined' ? (window.Luker?.getContext?.() || window.SillyTavern?.getContext?.()) : null;
  const currentChatFile = ctx?.chatId || ctx?.chatMetadata?.file_name || '';

  // 1. LCA 分叉点摘要
  const lca = diffResult.lcaNode;
  const lcaContainer = modal.querySelector('#diffLcaSummary');
  if (lca) {
    const lcaSender = escapeHtml(lca.name || (lca.isUser ? 'User' : 'AI'));
    const lcaSnippet = escapeHtml((lca.msg || '').slice(0, 100));
    lcaContainer.innerHTML = `
      <div class="lca-title"><span class="fa-solid fa-code-fork"></span> 最近公共祖先分叉点（第 ${diffResult.commonDepth + 1} 轮）</div>
      <div class="lca-content"><b>${lcaSender}:</b> "${lcaSnippet}${lca.msg && lca.msg.length > 100 ? '...' : ''}"</div>
    `;
  } else {
    lcaContainer.innerHTML = `
      <div class="lca-title"><span class="fa-solid fa-triangle-exclamation"></span> 两条分支无公共前缀（从首轮即已分化）</div>
    `;
  }

  // 2. 差异统计指标栏
  const statsContainer = modal.querySelector('#diffStatsBar');
  const countA = diffResult.diffA?.length || 0;
  const countB = diffResult.diffB?.length || 0;
  statsContainer.innerHTML = `
    <div class="timelines-diff-stat-item"><i class="fa-solid fa-layer-group"></i> 公共前缀深度：<b>${diffResult.commonDepth >= 0 ? diffResult.commonDepth + 1 : 0} 轮</b></div>
    <div class="timelines-diff-stat-item"><i class="fa-solid fa-code-commit" style="color:#58a6ff;"></i> 分支 A 独有：<b>${countA} 轮</b></div>
    <div class="timelines-diff-stat-item"><i class="fa-solid fa-code-commit" style="color:#a855f7;"></i> 分支 B 独有：<b>${countB} 轮</b></div>
  `;

  // 3. 分支标题与当前会话徽章
  modal.querySelector('#diffColNameA').textContent = nameA;
  modal.querySelector('#diffColNameB').textContent = nameB;

  const isCurrentA = currentChatFile && (currentChatFile === nameA || `${currentChatFile}.jsonl` === nameA);
  const isCurrentB = currentChatFile && (currentChatFile === nameB || `${currentChatFile}.jsonl` === nameB);

  const badgeA = modal.querySelector('#colBadgeA');
  const badgeB = modal.querySelector('#colBadgeB');
  badgeA.textContent = isCurrentA ? '分支 A (当前)' : '分支 A';
  badgeB.textContent = isCurrentB ? '分支 B (当前)' : '分支 B';

  // 4. 进入分支切换按钮
  const btnA = modal.querySelector('#switchBranchBtnA');
  const btnB = modal.querySelector('#switchBranchBtnB');

  btnA.onclick = async () => {
    if (nameA && nameA !== '分支 A') {
      await openCharacterChat(nameA.replace(/\.jsonl$/i, ''));
      toastr.success(`已切换至分支 ${nameA}`);
      closeDiffModal();
    }
  };

  btnB.onclick = async () => {
    if (nameB && nameB !== '分支 B') {
      await openCharacterChat(nameB.replace(/\.jsonl$/i, ''));
      toastr.success(`已切换至分支 ${nameB}`);
      closeDiffModal();
    }
  };

  // 5. 渲染双栏消息列表
  renderMessageCards(modal.querySelector('#diffMsgListA'), diffResult.diffA, isCurrentA);
  renderMessageCards(modal.querySelector('#diffMsgListB'), diffResult.diffB, isCurrentB);

  // 6. 绑定基于分叉点合并派生新分支
  const mergeBtn = modal.querySelector('#mergeBranchesBtn');
  mergeBtn.onclick = async () => {
    if (!lca || typeof lca.messageId !== 'number') {
      toastr.warning('两分支无公共祖先节点或未关联楼层，无法在 LCA 处派生合并。');
      return;
    }

    mergeBtn.disabled = true;
    mergeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 派生合并中...';

    try {
      // 1. 基于 LCA 创建全新分支 (100% 保持原生元数据与前缀序列)
      toastr.info(`正在以分叉点第 ${lca.messageId} 楼为基底派生合并分支...`);
      const newBranch = await createBranch(lca.messageId);
      if (!newBranch) {
        throw new Error('酒馆未能生成有效的新分支');
      }

      // 2. 切换至新派生分支
      await openCharacterChat(newBranch);
      await new Promise(r => setTimeout(r, 600));

      // 3. 获取新分支活跃上下文并注入 A、B 的差异消息
      const newCtx = window.Luker?.getContext?.() || window.SillyTavern?.getContext?.();
      if (newCtx && Array.isArray(newCtx.chat)) {
        for (const item of (diffResult.diffA || [])) {
          await cherryPickMessageToCurrentChat(item, newCtx);
        }
        for (const item of (diffResult.diffB || [])) {
          await cherryPickMessageToCurrentChat(item, newCtx);
        }
      }

      toastr.success(`已成功派生合并分支：${newBranch}`);
      closeDiffModal();

      if (typeof onReload === 'function') {
        await onReload(true);
      }
    } catch (err) {
      console.error('[DiffModal] 合并分支失败:', err);
      toastr.error(`合并分支失败: ${err.message || err}`);
      mergeBtn.disabled = false;
      mergeBtn.innerHTML = '<i class="fa-solid fa-code-merge"></i> 合并两分支为新会话';
    }
  };

  modal.classList.remove('hidden');
}

/**
 * 关闭多分支差异对比模态框
 */
export function closeDiffModal() {
  if (diffModalElement) {
    diffModalElement.classList.add('hidden');
  }
}
