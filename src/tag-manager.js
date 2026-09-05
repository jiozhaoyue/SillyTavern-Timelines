/**
 * @file tag-manager.js
 * @description 基于酒馆原生 message.extra 的节点书签与彩色标签管理系统
 * 严格遵循原生酒馆/Luker数据契约：无私有数据库，所有标签与书签均持久化于原生 chat 文件的 message.extra 中。
 */

import { registerNodeDecorator, registerContextMenuAction } from './api.js';
import { escapeHtml } from './helpers.js';
import { timelinesCache } from './cache.js';

export const DEFAULT_TAG_PALETTE = [
  { name: '主线', color: '#f59e0b' }, // 琥珀黄
  { name: '战斗', color: '#ef4444' }, // 珊瑚红
  { name: '日常', color: '#3b82f6' }, // 天蓝
  { name: '好感', color: '#10b981' }, // 翠绿
  { name: '伏笔', color: '#a855f7' }, // 紫罗兰
  { name: '备忘', color: '#94a3b8' }, // 石板灰
];

/**
 * 从节点数据中解析所有原生标签
 * @param {object} nodeData
 * @returns {Array<{name: string, color: string}>}
 */
export function extractNodeTags(nodeData) {
  if (!nodeData) return [];
  const tags = [];

  // 1. 如果 nodeData 上直接挂有 tags
  if (Array.isArray(nodeData.tags)) {
    for (const t of nodeData.tags) {
      if (typeof t === 'string' && t.trim()) {
        const matched = DEFAULT_TAG_PALETTE.find(p => p.name === t.trim());
        tags.push({ name: t.trim(), color: matched ? matched.color : '#38bdf8' });
      } else if (t && typeof t === 'object' && t.name) {
        tags.push({ name: String(t.name).trim(), color: t.color || '#38bdf8' });
      }
    }
  }

  // 2. 从原生 message.extra 读取
  const extra = nodeData.extra || nodeData.swipeExtra;
  if (extra && Array.isArray(extra.tags)) {
    for (const t of extra.tags) {
      if (typeof t === 'string' && t.trim()) {
        const matched = DEFAULT_TAG_PALETTE.find(p => p.name === t.trim());
        tags.push({ name: t.trim(), color: matched ? matched.color : '#38bdf8' });
      } else if (t && typeof t === 'object' && t.name) {
        tags.push({ name: String(t.name).trim(), color: t.color || '#38bdf8' });
      }
    }
  }

  // 去重 (按 name)
  const map = new Map();
  for (const t of tags) {
    if (!map.has(t.name)) {
      map.set(t.name, t);
    }
  }
  return Array.from(map.values());
}

/**
 * 校验节点是否具有标签或自定义书签
 * @param {object} nodeData
 * @returns {boolean}
 */
export function hasNodeTagsOrBookmark(nodeData) {
  if (!nodeData) return false;
  if (nodeData.isBookmark || nodeData.bookmarkName) return true;
  const tags = extractNodeTags(nodeData);
  return tags.length > 0;
}

/**
 * 将标签保存到酒馆当前活动会话的原生消息中
 * @param {number} messageId - 消息楼层
 * @param {Array<{name: string, color: string}>} tags - 标签列表
 * @param {object} [customContext]
 * @returns {Promise<boolean>}
 */
export async function saveMessageTagsNative(messageId, tags, customContext = null) {
  try {
    const ctx = customContext || window.Luker?.getContext?.() || window.SillyTavern?.getContext?.();
    if (!ctx || !Array.isArray(ctx.chat)) {
      console.warn('[TagManager] 未找到有效的聊天上下文');
      return false;
    }

    const idx = Number(messageId);
    if (!Number.isFinite(idx) || idx < 0 || idx >= ctx.chat.length) {
      console.warn('[TagManager] 非法消息索引:', messageId);
      return false;
    }

    const message = ctx.chat[idx];
    if (!message) return false;
    if (!message.extra) message.extra = {};

    message.extra.tags = tags.map(t => ({
      name: String(t.name).trim(),
      color: t.color || '#38bdf8',
    }));

    // 调用酒馆原生持久化函数
    if (typeof ctx.saveChatDebounced === 'function') {
      await ctx.saveChatDebounced();
    } else if (typeof window.saveChatDebounced === 'function') {
      await window.saveChatDebounced();
    }

    // 清理对应角色的时间树缓存，保证下次重拉数据一致性
    const scopeKey = !ctx.characterId ? `group_${ctx.groupId}` : `char_${ctx.characterId}`;
    const fileName = ctx.chatId || ctx.chatMetadata?.file_name;
    if (fileName) {
      await timelinesCache.removeChat(scopeKey, fileName);
    }

    return true;
  } catch (err) {
    console.error('[TagManager] 保存消息标签异常:', err);
    return false;
  }
}

/**
 * 初始化原生书签与标签修饰器
 */
export function initTagDecorator() {
  registerNodeDecorator({
    id: 'native-tags',
    priority: 10,
    decorateNode(cyNode, nodeData) {
      const tags = extractNodeTags(nodeData);
      if (tags.length > 0) {
        cyNode.addClass('has-custom-tags');
        cyNode.data('customTags', tags);
        const primaryColor = tags[0].color;
        cyNode.data('primaryTagColor', primaryColor);
      }
    },
    getTooltipPrefix(cyNode) {
      const tags = cyNode?.data?.('customTags');
      if (Array.isArray(tags) && tags.length > 0) {
        return '🏷️ ';
      }
      return '';
    },
    getCardSection(cyNode) {
      const tags = cyNode?.data?.('customTags') || [];
      const isBookmark = cyNode?.data?.('isBookmark');
      const bookmarkName = cyNode?.data?.('bookmarkName');

      if (tags.length === 0 && !isBookmark) {
        return `
          <div class="node-tag-section">
            <button class="menu_button tl-manage-tags-btn" style="padding:3px 8px;font-size:0.82em;margin-top:6px;">
              🏷️ 添加标签与书签
            </button>
          </div>
        `;
      }

      const tagsHtml = tags
        .map(
          t => `
          <span class="tl-tag-chip" style="background:${escapeHtml(t.color)}25;border-color:${escapeHtml(t.color)}80;color:${escapeHtml(t.color)};">
            ${escapeHtml(t.name)}
          </span>
        `
        )
        .join('');

      return `
        <div class="node-tag-section">
          <div class="node-tag-header">
            <span>🏷️ 标签与书签</span>
            <button class="tl-manage-tags-btn-link" title="编辑标签">编辑</button>
          </div>
          <div class="tl-tags-list">
            ${isBookmark ? `<span class="tl-tag-chip is-bookmark">🔖 ${escapeHtml(bookmarkName || '书签')}</span>` : ''}
            ${tagsHtml}
          </div>
        </div>
      `;
    },
    isProtected(nodeData) {
      return hasNodeTagsOrBookmark(nodeData);
    },
  });

  registerContextMenuAction({
    id: 'tl-manage-tags',
    content: '🏷️ 管理标签与书签',
    selector: 'node[?msg]',
    onClick(node) {
      openManageTagsModal(node);
    },
  });
}

/**
 * 弹出标签与书签编辑模态框
 * @param {object} node - Cytoscape 节点对象
 * @param {Function} [onSaved]
 */
export function openManageTagsModal(node, onSaved = null) {
  const existing = document.querySelector('.timelines-tag-modal');
  if (existing) existing.remove();

  const nodeId = node.id();
  const chatSessions = node.data('chat_sessions') || {};
  const entries = Object.entries(chatSessions);
  const messageId = entries[0]?.[1]?.messageId ?? node.data('chat_depth');
  const currentTags = extractNodeTags(node.data());

  let selectedTags = [...currentTags];

  const modalHtml = `
    <div class="timelines-tag-modal">
      <h3><span>🏷️</span> 管理节点标签 (第 ${messageId ?? '?'} 楼)</h3>
      <div style="font-size:0.85em;opacity:0.8;margin-bottom:6px;">为时间线节点打上自定义彩色标签，支持在顶部书签抽屉中一键定位。</div>

      <div class="tl-tag-current-container">
        <label style="display:block;font-size:0.85em;margin-bottom:4px;font-weight:600;">已选标签：</label>
        <div id="tl-selected-tags-box" class="tl-tags-list" style="min-height:30px;background:rgba(0,0,0,0.2);padding:6px;border-radius:6px;">
          <!-- 动态渲染 -->
        </div>
      </div>

      <div style="margin-top:10px;">
        <label style="display:block;font-size:0.85em;margin-bottom:4px;font-weight:600;">预设快捷色卡：</label>
        <div class="tl-tag-palette">
          ${DEFAULT_TAG_PALETTE.map(
            p => `
            <button class="tl-palette-btn" data-name="${escapeHtml(p.name)}" data-color="${escapeHtml(p.color)}" style="background:${escapeHtml(p.color)}20;border-color:${escapeHtml(p.color)}90;color:${escapeHtml(p.color)};">
              + ${escapeHtml(p.name)}
            </button>
          `
          ).join('')}
        </div>
      </div>

      <div style="margin-top:10px;display:flex;gap:6px;">
        <input type="text" id="tl-custom-tag-name" placeholder="自定义标签名..." style="flex:1;" />
        <input type="color" id="tl-custom-tag-color" value="#38bdf8" style="width:40px;height:36px;padding:0;background:none;border:none;cursor:pointer;" />
        <button id="tl-add-custom-tag-btn" class="menu_button" style="white-space:nowrap;">添加</button>
      </div>

      <div class="timelines-memory-modal-actions" style="margin-top:14px;">
        <button id="tl-tag-cancel" class="menu_button">取消</button>
        <button id="tl-tag-save" class="menu_button" style="background:#0284c7;color:#fff;">保存标签</button>
      </div>
    </div>
  `;

  const container = document.createElement('div');
  container.innerHTML = modalHtml.trim();
  const modalEl = container.firstChild;
  document.body.appendChild(modalEl);

  function renderSelectedTags() {
    const box = modalEl.querySelector('#tl-selected-tags-box');
    if (selectedTags.length === 0) {
      box.innerHTML = '<span style="font-size:0.8em;opacity:0.6;">暂无标签，可点击下方预设或手动添加</span>';
      return;
    }
    box.innerHTML = selectedTags
      .map(
        (t, idx) => `
        <span class="tl-tag-chip" style="background:${escapeHtml(t.color)}25;border-color:${escapeHtml(t.color)}80;color:${escapeHtml(t.color)};">
          ${escapeHtml(t.name)}
          <span class="tl-remove-tag fa-solid fa-times" data-idx="${idx}" style="margin-left:4px;cursor:pointer;"></span>
        </span>
      `
      )
      .join('');

    box.querySelectorAll('.tl-remove-tag').forEach(btn => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-idx'));
        selectedTags.splice(i, 1);
        renderSelectedTags();
      };
    });
  }

  renderSelectedTags();

  modalEl.querySelectorAll('.tl-palette-btn').forEach(btn => {
    btn.onclick = () => {
      const name = btn.getAttribute('data-name');
      const color = btn.getAttribute('data-color');
      if (!selectedTags.some(t => t.name === name)) {
        selectedTags.push({ name, color });
        renderSelectedTags();
      }
    };
  });

  modalEl.querySelector('#tl-add-custom-tag-btn').onclick = () => {
    const input = modalEl.querySelector('#tl-custom-tag-name');
    const colorInput = modalEl.querySelector('#tl-custom-tag-color');
    const name = input.value.trim();
    const color = colorInput.value;
    if (!name) return;
    if (!selectedTags.some(t => t.name === name)) {
      selectedTags.push({ name, color });
      renderSelectedTags();
    }
    input.value = '';
  };

  modalEl.querySelector('#tl-tag-cancel').onclick = () => modalEl.remove();
  modalEl.querySelector('#tl-tag-save').onclick = async () => {
    if (typeof messageId !== 'number') {
      toastr.warning('未能定位消息楼层索引');
      return;
    }

    const ok = await saveMessageTagsNative(messageId, selectedTags);
    if (ok) {
      toastr.success(`已保存第 ${messageId} 楼标签 (${selectedTags.length} 个)`);
      node.data('tags', selectedTags);
      node.data('customTags', selectedTags);
      if (selectedTags.length > 0) {
        node.addClass('has-custom-tags');
        node.data('primaryTagColor', selectedTags[0].color);
      } else {
        node.removeClass('has-custom-tags');
      }
      modalEl.remove();
      if (typeof onSaved === 'function') {
        onSaved(selectedTags);
      }
    } else {
      toastr.error('保存标签失败，未找到聊天上下文');
    }
  };
}

/**
 * 顶部书签与彩色标签抽屉组件
 */
export class TagsDrawer {
  /**
   * @param {object} cy - Cytoscape 实例
   * @param {HTMLElement} [parentContainer] - 挂载父容器 (默认 #networkContainer)
   */
  constructor(cy, parentContainer = null) {
    this.cy = cy;
    this.parentContainer = parentContainer || document.getElementById('networkContainer') || document.body;
    this.isOpen = false;
    this.currentFilter = 'all'; // 'all' | 'bookmarks' | 'tags'
    this.searchQuery = '';
    this.drawerElement = null;

    this.initDOM();
  }

  /**
   * 初始化抽屉 DOM 容器与基础事件
   */
  initDOM() {
    let drawer = this.parentContainer.querySelector('#timelinesTagsDrawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'timelinesTagsDrawer';
      drawer.className = 'timelines-tags-drawer hidden';
      drawer.innerHTML = `
        <div class="timelines-tags-drawer-inner">
          <div class="timelines-tags-drawer-header">
            <span class="timelines-tags-drawer-title"><i class="fa-solid fa-bookmark"></i> 书签与标签索引</span>
            <div class="timelines-tags-filter-group">
              <button class="tl-filter-chip active" data-filter="all">全部</button>
              <button class="tl-filter-chip" data-filter="bookmarks">🔖 书签</button>
              <button class="tl-filter-chip" data-filter="tags">🏷️ 标签</button>
            </div>
            <input type="text" class="timelines-tags-search-input" placeholder="过滤标签或文本..." />
            <button class="timelines-tags-drawer-close fa-solid fa-chevron-up" title="收起抽屉"></button>
          </div>
          <div class="timelines-tags-cards-container" id="timelinesTagsCardsContainer"></div>
        </div>
      `;
      this.parentContainer.appendChild(drawer);
    }
    this.drawerElement = drawer;

    const closeBtn = this.drawerElement.querySelector('.timelines-tags-drawer-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.hide();
    }

    this.drawerElement.querySelectorAll('.tl-filter-chip').forEach(btn => {
      btn.onclick = () => {
        this.drawerElement.querySelectorAll('.tl-filter-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.getAttribute('data-filter') || 'all';
        this.renderCards();
      };
    });

    const searchInput = this.drawerElement.querySelector('.timelines-tags-search-input');
    if (searchInput) {
      searchInput.oninput = () => {
        this.searchQuery = searchInput.value.trim().toLowerCase();
        this.renderCards();
      };
    }
  }

  /**
   * 展开抽屉
   */
  show() {
    this.isOpen = true;
    this.drawerElement?.classList.remove('hidden');
    const toggleBtn = this.parentContainer.querySelector('.toggle-tags-drawer');
    if (toggleBtn) toggleBtn.classList.add('active');
    this.renderCards();
  }

  /**
   * 收起抽屉
   */
  hide() {
    this.isOpen = false;
    this.drawerElement?.classList.add('hidden');
    const toggleBtn = this.parentContainer.querySelector('.toggle-tags-drawer');
    if (toggleBtn) toggleBtn.classList.remove('active');
  }

  /**
   * 切换展开/收起
   */
  toggle() {
    if (this.isOpen) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 渲染带标签或书签的节点卡片流
   */
  renderCards() {
    if (!this.drawerElement || !this.cy) return;
    const listContainer = this.drawerElement.querySelector('#timelinesTagsCardsContainer');
    if (!listContainer) return;

    const nodes = this.cy.nodes().filter(n => {
      const d = n.data();
      if (!d || d.label === 'root' || d.isCollapsedCluster) return false;
      const hasTags = (d.customTags && d.customTags.length > 0) || (extractNodeTags(d).length > 0);
      const isBookmark = Boolean(d.isBookmark || d.bookmarkName);

      if (this.currentFilter === 'bookmarks') return isBookmark;
      if (this.currentFilter === 'tags') return hasTags;
      return isBookmark || hasTags;
    });

    const query = this.searchQuery;
    const filteredNodes = nodes.filter(n => {
      if (!query) return true;
      const d = n.data();
      const tags = d.customTags || extractNodeTags(d);
      const tagMatch = tags.some(t => (t.name || '').toLowerCase().includes(query));
      const msgMatch = (d.msg || '').toLowerCase().includes(query);
      const bookmarkMatch = (d.bookmarkName || '').toLowerCase().includes(query);
      return tagMatch || msgMatch || bookmarkMatch;
    });

    if (filteredNodes.length === 0) {
      listContainer.innerHTML = `
        <div class="timelines-tags-empty">
          <i class="fa-solid fa-tags" style="font-size:1.8em;opacity:0.4;margin-bottom:8px;"></i>
          <div>暂无符合条件的书签或彩色标签</div>
          <div style="font-size:0.8em;opacity:0.6;margin-top:4px;">在时间线中右键节点或在节点信息卡中点击“添加标签与书签”</div>
        </div>
      `;
      return;
    }

    let html = '';
    filteredNodes.forEach(n => {
      const d = n.data();
      const tags = d.customTags || extractNodeTags(d);
      const isBookmark = Boolean(d.isBookmark || d.bookmarkName);
      const bookmarkName = d.bookmarkName || '书签检查点';
      const msgText = d.msg || '';
      const preview = msgText.length > 80 ? msgText.substring(0, 80) + '...' : msgText;
      const floor = d.chat_depth ?? n.id();

      const tagsChips = tags
        .map(
          t => `
        <span class="tl-tag-chip" style="background:${escapeHtml(t.color)}25;border-color:${escapeHtml(t.color)}80;color:${escapeHtml(t.color)};">
          ${escapeHtml(t.name)}
        </span>
      `
        )
        .join('');

      html += `
        <div class="tl-drawer-card" data-node-id="${escapeHtml(n.id())}">
          <div class="tl-drawer-card-header">
            <span class="tl-drawer-card-floor">#${floor}</span>
            ${isBookmark ? `<span class="tl-tag-chip is-bookmark">🔖 ${escapeHtml(bookmarkName)}</span>` : ''}
            <div class="tl-drawer-card-tags">${tagsChips}</div>
          </div>
          <div class="tl-drawer-card-preview">${escapeHtml(preview)}</div>
        </div>
      `;
    });

    listContainer.innerHTML = html;

    listContainer.querySelectorAll('.tl-drawer-card').forEach(card => {
      card.onclick = () => {
        const nodeId = card.getAttribute('data-node-id');
        const targetNode = this.cy.getElementById(nodeId);
        if (targetNode && targetNode.length > 0) {
          this.cy.animate(
            {
              center: { eles: targetNode },
              zoom: Math.max(this.cy.zoom(), 1.0),
            },
            { duration: 350 }
          );
          targetNode.flashClass('tl-node-pulse', 1200);
        }
      };
    });
  }

  /**
   * 销毁并清理 DOM
   */
  destroy() {
    if (this.drawerElement) {
      this.drawerElement.remove();
      this.drawerElement = null;
    }
  }
}

