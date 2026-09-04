/**
 * @file diff-modal.js
 * 渲染多分支差异对比浮层 (Diff Modal)。
 * 展示两分支在 LCA 最近公共祖先分叉点之后的走向，并支持一键无缝跳转。
 */

import { escapeHtml } from '../../../../utils.js';
import { openCharacterChat } from '../../../../../script.js';

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
                    <span class="fa-solid fa-code-branch"></span>
                    <span id="diffModalTitle">分支差异对比 (Diff View)</span>
                </div>
                <button id="closeDiffModalBtn" class="fa-solid fa-xmark timelines-diff-close" title="关闭对比窗口"></button>
            </div>
            <div id="diffLcaSummary" class="timelines-diff-lca">
                <!-- LCA 分叉点摘要由 JS 动态填充 -->
            </div>
            <div class="timelines-diff-body">
                <div class="timelines-diff-column" id="diffColumnA">
                    <div class="timelines-diff-col-header" id="diffColHeaderA">
                        <span class="col-badge">分支 A</span>
                        <span class="col-name" id="diffColNameA"></span>
                        <button class="menu_button switch-branch-btn" id="switchBranchBtnA" title="切换并进入此分支">进入此分支</button>
                    </div>
                    <div class="timelines-diff-message-list" id="diffMsgListA"></div>
                </div>
                <div class="timelines-diff-column" id="diffColumnB">
                    <div class="timelines-diff-col-header" id="diffColHeaderB">
                        <span class="col-badge">分支 B</span>
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

    diffModalElement.addEventListener('click', (evt) => {
        if (evt.target === diffModalElement) {
            closeDiffModal();
        }
    });

    return diffModalElement;
}

/**
 * 格式化渲染单侧消息卡片列表
 * @param {HTMLElement} containerElement
 * @param {Array} diffList
 */
function renderMessageCards(containerElement, diffList) {
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
        const swipeBadge = (item.totalSwipes > 1) ? `<span class="swipe-badge">Swipe ${item.swipeId + 1}/${item.totalSwipes}</span>` : '';

        card.innerHTML = `
            <div class="card-meta">
                <span class="sender-name">${roleName}</span>
                <span class="floor-badge">${floorText}</span>
                ${swipeBadge}
            </div>
            <div class="card-text">${textContent}</div>
        `;
        containerElement.appendChild(card);
    });
}

/**
 * 打开并展示多分支差异对比模态框
 * @param {Object} diffResult - computeBranchLCA 返回的差异对象
 * @param {string} [nameA='分支 A']
 * @param {string} [nameB='分支 B']
 */
export function showDiffModal(diffResult, nameA = '分支 A', nameB = '分支 B') {
    const modal = ensureDiffModal();

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

    modal.querySelector('#diffColNameA').textContent = nameA;
    modal.querySelector('#diffColNameB').textContent = nameB;

    const btnA = modal.querySelector('#switchBranchBtnA');
    const btnB = modal.querySelector('#switchBranchBtnB');

    btnA.onclick = async () => {
        if (nameA && nameA !== '分支 A') {
            await openCharacterChat(nameA.replace('.jsonl', ''));
            toastr.success(`已切换至分支 ${nameA}`);
            closeDiffModal();
        }
    };

    btnB.onclick = async () => {
        if (nameB && nameB !== '分支 B') {
            await openCharacterChat(nameB.replace('.jsonl', ''));
            toastr.success(`已切换至分支 ${nameB}`);
            closeDiffModal();
        }
    };

    renderMessageCards(modal.querySelector('#diffMsgListA'), diffResult.diffA);
    renderMessageCards(modal.querySelector('#diffMsgListB'), diffResult.diffB);

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
