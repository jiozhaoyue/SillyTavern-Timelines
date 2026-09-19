/**
 * @file story-outline-modal.js
 * @description 全景故事大纲与剧情摘要交互式对话框
 */

import {
  extractStoryOutline,
  formatStoryOutlineMarkdown,
  downloadMarkdownFile,
} from './story-outline-service.js';
import { copyBlobToClipboard } from './export-service.js';
import { escapeHtml } from './helpers.js';
import { getFullNodeText } from './node-data.js';

let outlineBackdrop = null;

/**
 * 为省内存模式预解析节点全文（nodeId -> 全文）。
 *
 * @param {object} cy - Cytoscape 实例。
 * @returns {Promise<Map<string, string>>} 无截断节点或解析失败时对应条目缺失。
 */
async function buildFullTextMap(cy) {
  const map = new Map();
  if (!cy || typeof cy.nodes !== 'function') return map;
  for (const node of cy.nodes()) {
    if (!node.data('msgTruncated')) continue;
    try {
      const full = await getFullNodeText(node.data());
      if (typeof full === 'string' && full) {
        map.set(node.id(), full);
      }
    } catch {
      /* 解析失败保持预览 */
    }
  }
  return map;
}

/**
 * 打开全局故事大纲模态框
 *
 * @param {object} cy - Cytoscape 实例
 * @param {object} [context=null] - 当前酒馆运行上下文
 */
export async function openStoryOutlineModal(cy, context = null) {
  if (!cy) {
    toastr.warning('时间线尚未加载完成');
    return;
  }

  const existing = document.getElementById('timelines-outline-backdrop');
  if (existing) existing.remove();

  const ctx = context || (typeof window !== 'undefined' ? (window.Luker?.getContext?.() || window.SillyTavern?.getContext?.()) : null);
  const fullTextMap = await buildFullTextMap(cy);
  const outlineData = extractStoryOutline(cy, ctx, fullTextMap);

  outlineBackdrop = document.createElement('div');
  outlineBackdrop.id = 'timelines-outline-backdrop';
  outlineBackdrop.className = 'timelines-outline-backdrop';

  const stats = outlineData.stats;
  const chapters = outlineData.chapters;

  outlineBackdrop.innerHTML = `
    <div class="timelines-outline-dialog">
      <div class="timelines-outline-header">
        <div class="timelines-outline-title">
          <i class="fa-solid fa-book-open" style="color:#38bdf8;"></i>
          <span>《${escapeHtml(outlineData.characterName)}》全景故事大纲与剧情摘要</span>
        </div>
        <div class="timelines-outline-actions">
          <button class="menu_button tl-btn-copy-md" title="复制完整 Markdown 大纲到剪贴板">
            <i class="fa-solid fa-copy"></i> 复制 Markdown
          </button>
          <button class="menu_button tl-btn-download-md" title="下载 .md 大纲文档">
            <i class="fa-solid fa-download"></i> 导出 .md
          </button>
          <button class="fa-solid fa-xmark timelines-outline-close" title="关闭大纲"></button>
        </div>
      </div>

      <div class="timelines-outline-stats">
        <span><i class="fa-solid fa-layer-group"></i> 共 <b>${stats.totalChapters}</b> 幕剧情</span>
        <span><i class="fa-solid fa-comments"></i> <b>${stats.totalEvents}</b> 轮对话 (${stats.userTurns} 用户 / ${stats.charTurns} 角色)</span>
        <span><i class="fa-solid fa-code-branch" style="color:#f59e0b;"></i> <b>${stats.totalForks}</b> 处分歧转折点</span>
        <span><i class="fa-solid fa-font"></i> 约 <b>${stats.approxWords}</b> 字</span>
      </div>

      <div class="timelines-outline-body">
        <div class="timelines-outline-sidebar">
          <div class="sidebar-title">章节目录导航</div>
          <div class="sidebar-nav-list">
            ${chapters.map((chap, idx) => `
              <div class="sidebar-nav-item" data-chap-id="${chap.id}">
                <span class="nav-idx">${idx + 1}</span>
                <span class="nav-name">${escapeHtml(chap.title)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="timelines-outline-content">
          ${chapters.length === 0 ? '<div class="outline-empty">当前会话暂无足够的剧情节点生成大纲。</div>' : ''}
          ${chapters.map(chap => `
            <div class="outline-chapter-section" id="${chap.id}">
              <div class="outline-chapter-title">
                <i class="fa-solid fa-film"></i>
                <span>${escapeHtml(chap.title)}</span>
                <span class="chap-badge">第 ${chap.startFloor} - ${chap.endFloor} 轮</span>
              </div>
              <div class="outline-events-timeline">
                ${chap.events.map(evt => `
                  <div class="outline-event-card ${evt.isUser ? 'is-user' : 'is-character'}" data-node-id="${evt.nodeId}" title="点击在画布中定位此节点">
                    <div class="event-meta">
                      <span class="event-floor">#${evt.messageId}</span>
                      <span class="event-role">${escapeHtml(evt.senderName)}</span>
                      ${evt.isBookmark ? '<span class="event-bookmark"><i class="fa-solid fa-bookmark"></i> 书签</span>' : ''}
                      ${evt.isForkPoint ? '<span class="event-fork"><i class="fa-solid fa-code-fork"></i> 剧情分歧</span>' : ''}
                      ${evt.tags.map(t => `<span class="tl-tag-chip" style="color:${t.color};border-color:${t.color};">${escapeHtml(t.name)}</span>`).join('')}
                      <span class="event-locate-hint"><i class="fa-solid fa-location-crosshairs"></i> 定位</span>
                    </div>
                    <div class="event-text">${escapeHtml(evt.textSnippet)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(outlineBackdrop);

  // 关闭逻辑
  const close = () => outlineBackdrop.remove();
  outlineBackdrop.querySelector('.timelines-outline-close').onclick = close;
  outlineBackdrop.onclick = e => {
    if (e.target === outlineBackdrop) close();
  };

  // 章节左侧目录滚动联动
  outlineBackdrop.querySelectorAll('.sidebar-nav-item').forEach(item => {
    item.onclick = () => {
      const chapId = item.getAttribute('data-chap-id');
      const targetSec = outlineBackdrop.querySelector(`#${chapId}`);
      if (targetSec) {
        targetSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        outlineBackdrop.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      }
    };
  });

  // 点击事件卡片，在 Cytoscape 画布中聚焦高亮对应节点
  outlineBackdrop.querySelectorAll('.outline-event-card').forEach(card => {
    card.onclick = () => {
      const nodeId = card.getAttribute('data-node-id');
      const cyNode = cy.getElementById(nodeId);
      if (cyNode && cyNode.nonempty()) {
        close();
        cy.stop().animate({
          center: { eles: cyNode },
          zoom: Math.max(cy.zoom(), 0.8),
        }, { duration: 350 });

        cyNode.addClass('tl-node-pulse');
        setTimeout(() => {
          cyNode.removeClass('tl-node-pulse');
        }, 1600);

        toastr.info(`已定位至节点 [${cyNode.data('label') || nodeId}]`);
      }
    };
  });

  // 复制 Markdown 大纲
  outlineBackdrop.querySelector('.tl-btn-copy-md').onclick = async () => {
    const mdText = formatStoryOutlineMarkdown(outlineData);
    try {
      await navigator.clipboard.writeText(mdText);
      toastr.success('已成功复制全景故事大纲至剪贴板！');
    } catch (err) {
      // 降级使用 textarea
      const ta = document.createElement('textarea');
      ta.value = mdText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toastr.success('已成功复制故事大纲至剪贴板');
    }
  };

  // 导出下载 .md 文档
  outlineBackdrop.querySelector('.tl-btn-download-md').onclick = () => {
    const mdText = formatStoryOutlineMarkdown(outlineData);
    const filename = `Story_Outline_${outlineData.characterName}_${new Date().toISOString().slice(0, 10)}.md`;
    downloadMarkdownFile(mdText, filename);
    toastr.success(`已开始下载大纲文档：${filename}`);
  };
}
