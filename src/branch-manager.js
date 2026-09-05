/**
 * @file branch-manager.js
 * 管理时间线节点的分支创建与清理。
 * 严格遵循酒馆原生能力体系，复用 bookmarks.js 与 script.js 的原生 API。
 */

import { event_types, eventSource, getRequestHeaders, openCharacterChat } from '../../../../../script.js';
import { createBranch } from '../../../../bookmarks.js';
import { getContext } from '../../../../extensions.js';
import { Popup, POPUP_TYPE } from '../../../../popup.js';
import { timelinesCache } from './cache.js';

function getTimelinesContext() {
  return window.Luker?.getContext?.() ?? window.SillyTavern?.getContext?.() ?? getContext();
}

export class BranchManager {
  /**
   * 基于选定的节点在原生酒馆中创建新分支
   * @param {Object} node - Cytoscape 节点对象
   * @param {Function} [onSuccess] - 成功后的回调通知
   * @returns {Promise<string|null>} 新分支会话文件名
   */
  async createBranchFromNode(node, onSuccess = null) {
    if (!node || typeof node.data !== 'function') {
      toastr.error('无法从无效节点创建分支。');
      return null;
    }

    const chatSessions = node.data('chat_sessions');
    if (!chatSessions || Object.keys(chatSessions).length === 0) {
      toastr.warning('当前节点没有关联的会话信息，无法分叉。');
      return null;
    }

    const entries = Object.entries(chatSessions);
    const [sourceFile, meta] = entries[0];
    const messageId = meta?.messageId;

    if (typeof messageId !== 'number' || messageId < 0) {
      toastr.warning('未能定位消息楼层索引，无法分叉。');
      return null;
    }

    const isSwipe = Boolean(node.data('isSwipe'));
    const swipeId = isSwipe ? (node.data('swipeId') ?? null) : null;

    try {
      toastr.info(`正在从第 ${messageId} 楼创建新分支...`);
      // 调用酒馆原生 createBranch
      const newBranchName = await createBranch(messageId, { swipeId });
      if (!newBranchName) {
        toastr.error('创建分支失败，酒馆未返回有效会话名称。');
        return null;
      }

      // 切换至新创建的会话
      await openCharacterChat(newBranchName);
      toastr.success(`已成功创建并切换至新分支：${newBranchName}`);

      if (typeof onSuccess === 'function') {
        await onSuccess(newBranchName);
      }
      return newBranchName;
    } catch (err) {
      console.error('Timelines: 创建分支异常：', err);
      toastr.error(`创建分支失败: ${err.message || err}`);
      return null;
    }
  }

  /**
   * 安全删除选定节点所属的会话文件（仅通过酒馆后端原生 /api/chats/delete）
   * @param {Object} node - Cytoscape 节点对象
   * @param {Function} [onDeleted] - 删除成功后的回调刷新
   * @returns {Promise<boolean>}
   */
  async deleteBranchFromNode(node, onDeleted = null) {
    if (!node || typeof node.data !== 'function') {
      return false;
    }

    const chatSessions = node.data('chat_sessions');
    if (!chatSessions || Object.keys(chatSessions).length === 0) {
      toastr.warning('未找到关联的聊天会话文件。');
      return false;
    }

    const fileNames = Object.keys(chatSessions);
    // 如果该节点被多个分支共享，明确提示
    const targetFile = fileNames[0];

    const context = getTimelinesContext();
    const character = context.characters?.[context.characterId];
    const avatarUrl = character?.avatar;

    if (!avatarUrl) {
      toastr.error('当前非单人角色聊天，无法执行分支删除。');
      return false;
    }

    // 调用酒馆原生确认弹窗
    const confirmText =
      fileNames.length > 1
        ? `该节点被 ${fileNames.length} 个分支共享。确定要删除分支 "${targetFile}" 吗？\n警告：删除后该会话文件将永久从硬盘移除！`
        : `确定要删除分支 "${targetFile}" 吗？\n警告：此操作将永久移除该聊天文件！`;

    const popup = new Popup(confirmText, POPUP_TYPE.CONFIRM, '', {
      okButton: '确认删除',
      cancelButton: '取消',
    });

    const confirmed = await popup.show();
    if (!confirmed) {
      return false;
    }

    try {
      const fileNameWithExt = targetFile.endsWith('.jsonl') ? targetFile : `${targetFile}.jsonl`;
      const response = await fetch('/api/chats/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          chatfile: fileNameWithExt,
          avatar_url: avatarUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      // 清理本地持久化缓存
      const scopeKey = `char_${context.characterId}`;
      await timelinesCache.removeChat(scopeKey, targetFile);
      await timelinesCache.removeChat(scopeKey, fileNameWithExt);

      toastr.success(`已删除分支 ${targetFile}`);

      // 广播原生删除事件通知酒馆全局状态与列表同步
      await eventSource.emit(event_types.CHAT_DELETED, targetFile);

      if (typeof onDeleted === 'function') {
        await onDeleted(targetFile);
      }
      return true;
    } catch (err) {
      console.error('Timelines: 删除分支失败：', err);
      toastr.error(`删除分支失败: ${err.message || err}`);
      return false;
    }
  }
}

export const branchManager = new BranchManager();
