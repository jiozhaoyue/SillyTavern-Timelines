/**
 * @file memory-graph-adapter.js
 * @description Timelines <-> memory-graph 外部解耦适配器
 * 遵循微内核架构：通过 Timelines 暴露的 registerNodeDecorator / registerToolbarAction
 * 将记忆图谱信息注入到时间树中，Timelines 核心零特定依赖。
 */

import { registerNodeDecorator, registerToolbarAction, registerContextMenuAction } from '../api.js';
import {
  getMemoryGraphApi,
  buildMemoryIndexForGraph,
  createQuickMemoryEvent,
  getEventInjectionStatus,
  getMemoryBundleForMessage,
} from '../memory-graph-service.js';
import { highlightMemoryMilestones } from '../graph.js';
import { escapeHtml } from '../helpers.js';

let _memoryIndex = new Map();

/**
 * 初始化并挂载 memory-graph 适配器
 * @param {object} [customContext]
 * @returns {boolean} 是否成功发现并挂载
 */
export function initMemoryGraphAdapter(customContext = null) {
  const api = getMemoryGraphApi(customContext);
  if (!api) {
    return false;
  }

  // 1. 注册节点修饰器
  registerNodeDecorator({
    id: 'memory-graph',
    priority: 30,
    async beforeRender(context, elements) {
      try {
        _memoryIndex = await buildMemoryIndexForGraph(context, elements);
      } catch (err) {
        console.warn('[Timelines Adapter] 构建记忆索引异常:', err);
        _memoryIndex = new Map();
      }
    },
    decorateNode(cyNode, nodeData) {
      if (!cyNode || !nodeData) return;
      const meta = _memoryIndex.get(nodeData.id);
      if (meta) {
        cyNode.addClass('has-memory');
        cyNode.data('has_memory', true);
        cyNode.data('memoryBundle', meta.bundle);
        cyNode.data('injectionStatus', meta.injectionStatus);
        if (meta.injectionStatus === 'recall') {
          cyNode.addClass('memory-injected-recall');
        } else if (meta.injectionStatus === 'always') {
          cyNode.addClass('memory-injected-always');
        }
      }
    },
    getTooltipPrefix(cyNode) {
      return cyNode?.data?.('has_memory') ? '🧠 ' : '';
    },
    getCardSection(cyNode) {
      const bundle = cyNode?.data?.('memoryBundle');
      if (!bundle || !bundle.event) return '';

      const evt = bundle.event;
      const title = escapeHtml(evt.title || '未命名记忆');
      const summary = escapeHtml(evt.fields?.summary || evt.fields?.thought || evt.content || '无摘要');
      const location = bundle.location?.title ? escapeHtml(bundle.location.title) : null;
      const chars = Array.isArray(bundle.characters)
        ? bundle.characters.map(c => escapeHtml(c.title || c.name || '')).filter(Boolean).join(', ')
        : '';
      const injectionStatus = cyNode.data('injectionStatus') || 'none';

      let statusBadge = '';
      if (injectionStatus === 'recall') {
        statusBadge = '<span class="memory-badge badge-recall">🟢 检索命中 (Recall)</span>';
      } else if (injectionStatus === 'always') {
        statusBadge = '<span class="memory-badge badge-always">🟡 长期常驻 (Always)</span>';
      } else {
        statusBadge = '<span class="memory-badge badge-none">⚪ 未在当前Prompt注入</span>';
      }

      return `
        <div class="node-memory-card">
          <div class="node-memory-header">
            <span>🧠 关联记忆图谱 (memory-graph)</span>
            ${statusBadge}
          </div>
          <div class="node-memory-title">${title}</div>
          <div class="node-memory-summary">${summary}</div>
          <div class="node-memory-meta">
            ${location ? `<span>📍 ${location}</span>` : ''}
            ${chars ? `<span>👥 ${chars}</span>` : ''}
          </div>
        </div>
      `;
    },
    isProtected(nodeData) {
      return _memoryIndex.has(nodeData.id);
    },
  });

  // 2. 注册顶栏控制动作
  registerToolbarAction({
    id: 'memory-milestones',
    title: '过滤/高亮记忆关键节点 (Memory Milestones)',
    buttonClass: 'toggle-memory-milestones',
    onToggle(active, cy) {
      return highlightMemoryMilestones(cy, active);
    },
  });

  // 3. 注册右键菜单动作
  registerContextMenuAction({
    id: 'tl-view-memory',
    content: '🧠 查看关联记忆',
    tooltipText: '在 memory-graph 中查看此节点对应楼层的记忆事件',
    selector: 'node[?msg]',
    async onClick(node) {
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
  });

  registerContextMenuAction({
    id: 'tl-create-memory',
    content: '🧠 为此节点补录记忆',
    tooltipText: '通过 memory-graph 插件将此轮剧情快速记录为情景记忆',
    selector: 'node[?msg]',
    onClick(node) {
      openCreateMemoryModal(node);
    },
  });

  return true;
}

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
 * 弹出快速补录记忆模态框
 * @param {object} node - Cytoscape 节点对象
 */
function openCreateMemoryModal(node) {
  const existing = document.querySelector('.timelines-memory-modal');
  if (existing) existing.remove();

  const nodeId = node.id();
  const chatSessions = node.data('chat_sessions') || {};
  const entries = Object.entries(chatSessions);
  const messageId = entries[0]?.[1]?.messageId ?? node.data('chat_depth');
  const snippet = (node.data('msg') || '').slice(0, 100);

  const modalHtml = `
    <div class="timelines-memory-modal">
      <h3><span>🧠</span> 为时间线节点补录记忆</h3>
      <div style="font-size:0.85em;opacity:0.8;margin-bottom:4px;">节点 ID: ${escapeHtml(nodeId)} (第 ${messageId ?? '?'} 楼)</div>
      <div style="font-size:0.85em;color:#cbd5e1;background:rgba(255,255,255,0.05);padding:6px 8px;border-radius:4px;margin-bottom:8px;">
        "${escapeHtml(snippet)}${node.data('msg')?.length > 100 ? '...' : ''}"
      </div>
      <div>
        <label style="display:block;font-size:0.85em;margin-bottom:4px;">记忆标题 (Title)</label>
        <input type="text" id="tl-mem-title" placeholder="如：与艾莉亚的重要对话" />
      </div>
      <div>
        <label style="display:block;font-size:0.85em;margin-bottom:4px;">记忆摘要 (Summary)</label>
        <textarea id="tl-mem-summary" placeholder="简述该节点发生的关键情节、人物态度转变或决策..."></textarea>
      </div>
      <div class="timelines-memory-modal-actions">
        <button id="tl-mem-cancel" class="menu_button">取消</button>
        <button id="tl-mem-submit" class="menu_button" style="background:#8b5cf6;color:#fff;">保存并同步</button>
      </div>
    </div>
  `;

  const container = document.createElement('div');
  container.innerHTML = modalHtml.trim();
  const modalEl = container.firstChild;
  document.body.appendChild(modalEl);

  modalEl.querySelector('#tl-mem-cancel').onclick = () => modalEl.remove();
  modalEl.querySelector('#tl-mem-submit').onclick = async () => {
    const title = modalEl.querySelector('#tl-mem-title').value.trim();
    const summary = modalEl.querySelector('#tl-mem-summary').value.trim();

    if (!title) {
      toastr.warning('请输入记忆标题');
      return;
    }

    try {
      const context = window.Luker?.getContext?.();
      const res = await createQuickMemoryEvent(messageId, { title, summary }, context);
      if (res.success) {
        toastr.success(`已为第 ${messageId} 楼创建记忆事件: "${title}"`);
        node.addClass('has-memory');
        node.data('has_memory', true);
        modalEl.remove();
      } else {
        toastr.error(`保存失败: ${res.reason || '未知错误'}`);
      }
    } catch (err) {
      toastr.error(`保存异常: ${err.message || err}`);
    }
  };
}
