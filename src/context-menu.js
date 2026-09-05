/**
 * @file context-menu.js
 * 负责时间线图的右键上下文菜单初始化、事件绑定与交互调度。
 */

import { branchManager } from './branch-manager.js';
import { showDiffModal } from './diff-modal.js';
import { computeBranchLCA, extractPathToRoot } from './diff-service.js';
import { escapeHtml } from './helpers.js';
import {
  createQuickMemoryEvent,
  getEventInjectionStatus,
  getMemoryBundleForMessage,
} from './memory-graph-service.js';
import { navigateToMessage } from './utils.js';

let diffBaseNodeA = null;

/**
 * 显示记忆事件详细卡片模态框
 * @param {object} bundle
 * @param {string} injectionStatus
 */
function showMemoryDetailsModal(bundle, injectionStatus) {
  const existing = document.getElementById('timelines-memory-detail-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'timelines-memory-detail-modal';
  modal.className = 'timelines-memory-modal';

  const evt = bundle.event || {};
  const loc = bundle.location;
  const chars = bundle.characters || [];

  let statusText = '未激活';
  let badgeClass = 'badge-none';
  if (injectionStatus === 'always') {
    statusText = '持久置顶注入';
    badgeClass = 'badge-always';
  } else if (injectionStatus === 'recall') {
    statusText = '本轮召回注入';
    badgeClass = 'badge-recall';
  }

  const charsText = chars.length > 0 ? chars.map(c => c.title || c.id).join('、') : '无';
  const locText = loc ? loc.title || loc.id : '未指定地点';

  modal.innerHTML = `
    <h3>🧠 关联长期记忆 (Memory Graph)</h3>
    <div style="font-size: 0.95rem; line-height: 1.5;">
      <div style="font-weight: bold; color: #f3e8ff; margin-bottom: 4px;">${escapeHtml(evt.title || '记忆事件')}</div>
      <div style="color: #cbd5e1; margin-bottom: 8px; background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px;">
        ${escapeHtml(evt.fields?.summary || evt.summary || '无摘要')}
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.88rem; color: #94a3b8;">
        <div>📍 <b>发生地点:</b> ${escapeHtml(locText)}</div>
        <div>👥 <b>登场角色:</b> ${escapeHtml(charsText)}</div>
        <div>⚡ <b>注入状态:</b> <span class="memory-badge ${badgeClass}">${statusText}</span></div>
      </div>
    </div>
    <div class="timelines-memory-modal-actions">
      <button class="menu_button close-btn" style="min-width: 80px;">关闭</button>
    </div>
  `;

  modal.querySelector('.close-btn').onclick = () => modal.remove();
  document.body.appendChild(modal);
}

/**
 * 弹出为节点补录记忆的对话框
 * @param {object} node
 * @param {Function} onSubmit
 */
function showCreateMemoryModal(node, onSubmit) {
  const existing = document.getElementById('timelines-create-memory-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'timelines-create-memory-modal';
  modal.className = 'timelines-memory-modal';

  const messageId = node.data('messageId');
  const rawMsg = node.data('msg') || '';
  const prefillSummary = rawMsg.slice(0, 180).replace(/\s+/g, ' ').trim();

  modal.innerHTML = `
    <h3>➕ 为此节点补录长期记忆</h3>
    <label style="font-size: 0.85rem; color: #94a3b8;">记忆标题</label>
    <input type="text" id="tl-mem-title-input" value="第 ${messageId ?? ''} 楼情景事件" />
    <label style="font-size: 0.85rem; color: #94a3b8;">记忆内容摘要</label>
    <textarea id="tl-mem-summary-input" placeholder="输入本轮对话产生的核心情景或重要设定...">${escapeHtml(prefillSummary)}</textarea>
    <div class="timelines-memory-modal-actions">
      <button class="menu_button cancel-btn">取消</button>
      <button class="menu_button submit-btn" style="background: rgba(168, 85, 247, 0.3); border-color: #a855f7;">确认录入</button>
    </div>
  `;

  modal.querySelector('.cancel-btn').onclick = () => modal.remove();
  modal.querySelector('.submit-btn').onclick = async () => {
    const title = modal.querySelector('#tl-mem-title-input').value.trim();
    const summary = modal.querySelector('#tl-mem-summary-input').value.trim();
    modal.remove();
    await onSubmit({ title, summary, messageIndex: Number(messageId) || 0 });
  };

  document.body.appendChild(modal);
}

/**
 * 获取节点的友好会话显示名称
 * @param {Object} node
 * @returns {string}
 */
function getNodeChatName(node) {
  const sessions = node?.data?.('chat_sessions');
  if (sessions && typeof sessions === 'object') {
    const keys = Object.keys(sessions);
    if (keys.length > 0) return keys[0];
  }
  return node?.id?.() || '未知节点';
}

/**
 * 初始化 Cytoscape 上下文菜单
 * @param {Object} cy - Cytoscape 实例
 * @param {Object} callbacks
 * @param {Function} [callbacks.onReload] - 刷新图谱回调
 * @returns {Object|null}
 */
export function initContextMenu(cy, { onReload } = {}) {
  if (!cy || typeof cy.contextMenus !== 'function') {
    console.warn('Timelines: cy.contextMenus 扩展未就绪，跳过右键菜单初始化。');
    return null;
  }

  const menuItems = [
    {
      id: 'tl-branch-here',
      content: '🔀 从此处创建新分支',
      tooltipText: '以当前消息为基准在酒馆中派生新会话',
      selector: 'node[?msg]',
      onClickFunction: async event => {
        const node = event.target || event.cyTarget;
        await branchManager.createBranchFromNode(node, async () => {
          if (typeof onReload === 'function') {
            await onReload(true);
          }
        });
      },
    },
    {
      id: 'tl-navigate-here',
      content: '🔍 跳转至此消息',
      tooltipText: '切换并定位到主聊天窗口对应楼层',
      selector: 'node[?msg]',
      onClickFunction: event => {
        const node = event.target || event.cyTarget;
        const sessions = node.data('chat_sessions');
        if (!sessions) return;
        const [fileName, meta] = Object.entries(sessions)[0];
        const isSwipe = Boolean(node.data('isSwipe'));
        const swipeId = isSwipe ? node.data('swipeId') : null;
        navigateToMessage(fileName, meta.messageId, swipeId);
      },
    },
    {
      id: 'tl-view-memory',
      content: '🧠 查看关联记忆',
      tooltipText: '在 memory-graph 中查看此节点对应楼层的记忆事件',
      selector: 'node[?msg]',
      onClickFunction: async event => {
        const node = event.target || event.cyTarget;
        let bundle = node.data('memoryBundle');
        let status = node.data('injectionStatus') || 'none';

        if (!bundle) {
          const context = window.Luker?.getContext?.();
          const messageId = node.data('messageId');
          if (context && messageId !== undefined) {
            bundle = await getMemoryBundleForMessage(context, messageId);
            if (bundle?.event?.id) {
              status = getEventInjectionStatus(context, bundle.event.id);
            }
          }
        }

        if (bundle && bundle.event) {
          showMemoryDetailsModal(bundle, status);
        } else {
          toastr.info('此轮对话尚未在记忆图中沉淀长期记忆。您可选择“为此节点补录记忆”。');
        }
      },
    },
    {
      id: 'tl-create-memory',
      content: '➕ 为此节点补录记忆',
      tooltipText: '通过 memory-graph 插件将此轮剧情快速记录为情景记忆',
      selector: 'node[?msg]',
      onClickFunction: event => {
        const node = event.target || event.cyTarget;
        showCreateMemoryModal(node, async ({ title, summary, messageIndex }) => {
          const context = window.Luker?.getContext?.();
          if (!context) {
            toastr.error('无法获取酒馆运行上下文');
            return;
          }

          const res = await createQuickMemoryEvent(context, { messageIndex, title, summary });
          if (res.success) {
            toastr.success('已成功录入记忆事件！');
            node.addClass('has-memory');
            node.data('has_memory', true);
            node.data('memoryBundle', {
              event: { id: res.id, title, fields: { summary } },
              location: null,
              characters: [],
            });
            node.data('injectionStatus', 'none');
          } else {
            toastr.error(`补录记忆失败: ${res.error}`);
          }
        });
      },
    },
    {
      id: 'tl-mark-diff-a',
      content: '📌 设为对比基准 A',
      tooltipText: '暂存该分支节点作为后续 Diff 对比的起点',
      selector: 'node[?msg]',
      onClickFunction: event => {
        diffBaseNodeA = event.target || event.cyTarget;
        const name = getNodeChatName(diffBaseNodeA);
        toastr.info(`已将 [${name}] 设为对比基准 A。请右键另一个分支节点选择“与基准 A 对比”。`);
      },
    },
    {
      id: 'tl-diff-with-a',
      content: '⚖️ 与对比基准 A 对比 (Diff)',
      tooltipText: '计算两分支分叉点及各自后续走向差异',
      selector: 'node[?msg]',
      show: true,
      onClickFunction: event => {
        const targetNode = event.target || event.cyTarget;
        if (!diffBaseNodeA) {
          toastr.warning('请先右键一个节点选择“设为对比基准 A”。');
          return;
        }

        try {
          const pathA = extractPathToRoot(diffBaseNodeA);
          const pathB = extractPathToRoot(targetNode);
          const diffResult = computeBranchLCA(pathA, pathB);
          const nameA = getNodeChatName(diffBaseNodeA);
          const nameB = getNodeChatName(targetNode);
          showDiffModal(diffResult, nameA, nameB);
        } catch (err) {
          console.error('Timelines: 计算分支差异异常：', err);
          toastr.error('计算分支差异失败');
        }
      },
    },
    {
      id: 'tl-delete-branch',
      content: '🗑️ 删除此会话分支',
      tooltipText: '永久删除此节点所属的会话文件 (带二次确认)',
      selector: 'node[?msg]',
      onClickFunction: async event => {
        const node = event.target || event.cyTarget;
        await branchManager.deleteBranchFromNode(node, async () => {
          if (typeof onReload === 'function') {
            await onReload(true);
          }
        });
      },
    },
    // 空白画布菜单
    {
      id: 'tl-fit-canvas',
      content: '🎯 缩放并居中全图',
      selector: 'core',
      onClickFunction: () => {
        cy.stop().animate({
          fit: { eles: cy.elements(), padding: 40 },
          duration: 250,
        });
      },
    },
    {
      id: 'tl-reload-canvas',
      content: '🔄 强制刷新时间线 [/tl r]',
      selector: 'core',
      onClickFunction: async () => {
        if (typeof onReload === 'function') {
          await onReload(true);
        }
      },
    },
  ];

  try {
    const cxtInstance = cy.contextMenus({
      menuItems,
      menuItemClasses: ['timelines-cxt-menuitem'],
      contextMenuClasses: ['timelines-cxt-menu'],
    });

    // 触控设备增强：支持手指长按节点时无缝在触点唤起上下文菜单
    cy.on('taphold', 'node[?msg]', function (evt) {
      const node = evt.target;
      const pos = evt.renderedPosition || evt.position;
      if (pos) {
        node.emit('cxttap', {
          position: pos,
          renderedPosition: pos,
        });
      }
    });

    return cxtInstance;
  } catch (e) {
    console.warn('Timelines: 注册上下文菜单失败：', e);
    return null;
  }
}
