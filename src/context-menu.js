/**
 * @file context-menu.js
 * 负责时间线图的右键上下文菜单初始化、事件绑定与交互调度。
 */

import { branchManager } from './branch-manager.js';
import { showDiffModal } from './diff-modal.js';
import { computeBranchLCA, extractPathToRoot } from './diff-service.js';
import { escapeHtml } from './helpers.js';
import { navigateToMessage } from './utils.js';
import { getContextMenuActions } from './api.js';
import { openManageTagsModal } from './tag-manager.js';

let diffBaseNodeA = null;

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

  // 动态扩展上下文菜单项 (由各个扩展适配器通过 registerContextMenuAction 注册)
  const dynamicItems = getContextMenuActions().map(action => ({
    id: action.id,
    content: action.content,
    tooltipText: action.tooltipText || '',
    selector: action.selector || 'node[?msg]',
    onClickFunction: event => {
      const node = event.target || event.cyTarget;
      action.onClick?.(node, event);
    },
  }));

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
      id: 'tl-manage-tags',
      content: '🏷️ 管理标签与书签',
      tooltipText: '为该节点添加/编辑自定义彩色标签或书签',
      selector: 'node[?msg]',
      onClickFunction: event => {
        const node = event.target || event.cyTarget;
        openManageTagsModal(node);
      },
    },
    ...dynamicItems,
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
