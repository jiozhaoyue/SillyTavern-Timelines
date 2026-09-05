/**
 * SillyTavern Timelines - Analytics Modal
 * 剧情分支深度量化统计与全景数据看板
 * 
 * 职责：
 * 1. 弹出全景数据分析看板模态窗（暗色高斯毛玻璃、响应式排版）。
 * 2. 渲染核心 KPI 卡片、角色对白天平、Swipes 探索深度与高频剧情标签分布。
 * 3. 提供一键复制研报、下载 Markdown 研报与 JSON 原始数据。
 */

import {
  calculateTimelineStats,
  formatAnalyticsMarkdown,
  formatAnalyticsJson,
} from './analytics-service.js';

let activeModalElement = null;

/**
 * 触发浏览器文件下载
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
 * 打开全景数据看板模态框
 * @param {object} cy Cytoscape 实例
 */
export function openAnalyticsModal(cy) {
  closeAnalyticsModal();

  const stats = calculateTimelineStats(cy);

  const backdrop = document.createElement('div');
  backdrop.className = 'timelines-analytics-backdrop';

  const modal = document.createElement('div');
  modal.className = 'timelines-analytics-dialog';

  // 角色发言比例
  const userWordPct = stats.speakers.user.wordPercent;
  const charWordPct = stats.speakers.character.wordPercent;
  const sysWordPct = stats.speakers.system.wordPercent;

  // 标签流
  const tagsHtml = stats.milestones.topTags.length > 0
    ? stats.milestones.topTags.map(t => `
        <span class="analytics-tag-pill">
          <i class="fa-solid fa-tag"></i> #${t.tag}
          <span class="tag-count">${t.count}</span>
        </span>
      `).join('')
    : '<span class="analytics-no-tags">暂无标记标签</span>';

  modal.innerHTML = `
    <div class="analytics-header">
      <div class="analytics-title-group">
        <div class="analytics-title">
          <i class="fa-solid fa-chart-pie"></i>
          <span>剧情时间树量化分析看板</span>
        </div>
        <div class="analytics-subtitle">全景拓扑量化 · 角色发言天平 · 剧本探索深度分析</div>
      </div>
      <button class="analytics-close-btn" title="关闭"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="analytics-body">
      <!-- 核心 KPI 卡片流 -->
      <div class="analytics-kpi-grid">
        <div class="analytics-kpi-card">
          <div class="kpi-icon"><i class="fa-solid fa-network-wired"></i></div>
          <div class="kpi-value">${stats.totalNodes}</div>
          <div class="kpi-label">剧情消息总数</div>
          <div class="kpi-sub">包含全分支轮次</div>
        </div>

        <div class="analytics-kpi-card">
          <div class="kpi-icon"><i class="fa-solid fa-code-branch"></i></div>
          <div class="kpi-value">${stats.leafNodes}</div>
          <div class="kpi-label">结局/分支末端</div>
          <div class="kpi-sub">当前已探索结局</div>
        </div>

        <div class="analytics-kpi-card">
          <div class="kpi-icon"><i class="fa-solid fa-route"></i></div>
          <div class="kpi-value">${stats.maxDepth}<span class="unit">轮</span></div>
          <div class="kpi-label">最大剧情深度</div>
          <div class="kpi-sub">平均深度 ${stats.avgDepth} 轮</div>
        </div>

        <div class="analytics-kpi-card">
          <div class="kpi-icon"><i class="fa-solid fa-shuffle"></i></div>
          <div class="kpi-value">${stats.branchPoints}</div>
          <div class="kpi-label">剧情分叉决策点</div>
          <div class="kpi-sub">平均每处 ${stats.avgBranchingFactor} 路径</div>
        </div>
      </div>

      <!-- 对话发言天平 -->
      <div class="analytics-section">
        <div class="section-title">
          <i class="fa-solid fa-scale-balanced"></i> 对白发言天平与角色分布
          <span class="section-badge">总规模: ${stats.content.totalWords} 字 / ${stats.totalNodes} 轮</span>
        </div>

        <!-- 比例进度条 -->
        <div class="dialogue-ratio-bar">
          <div class="ratio-segment user" style="width: ${userWordPct}%;" title="User 字数占比: ${userWordPct}%"></div>
          <div class="ratio-segment character" style="width: ${charWordPct}%;" title="Character 字数占比: ${charWordPct}%"></div>
          ${sysWordPct > 0 ? `<div class="ratio-segment system" style="width: ${sysWordPct}%;" title="System: ${sysWordPct}%"></div>` : ''}
        </div>

        <div class="speakers-detail-grid">
          <div class="speaker-stat-box user">
            <div class="speaker-role"><i class="fa-solid fa-user"></i> User (玩家)</div>
            <div class="speaker-metrics">
              <div class="metric-item"><strong>${stats.speakers.user.turns}</strong> 轮 (${stats.speakers.user.turnPercent}%)</div>
              <div class="metric-item"><strong>${stats.speakers.user.words}</strong> 字 (${stats.speakers.user.wordPercent}%)</div>
              <div class="metric-item">均 <strong>${stats.speakers.user.avgWords}</strong> 字/条</div>
            </div>
          </div>

          <div class="speaker-stat-box character">
            <div class="speaker-role"><i class="fa-solid fa-robot"></i> Character (角色)</div>
            <div class="speaker-metrics">
              <div class="metric-item"><strong>${stats.speakers.character.turns}</strong> 轮 (${stats.speakers.character.turnPercent}%)</div>
              <div class="metric-item"><strong>${stats.speakers.character.words}</strong> 字 (${stats.speakers.character.wordPercent}%)</div>
              <div class="metric-item">均 <strong>${stats.speakers.character.avgWords}</strong> 字/条</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Swipes 探索与里程碑 -->
      <div class="analytics-row-dual">
        <div class="analytics-section half">
          <div class="section-title">
            <i class="fa-solid fa-arrows-rotate"></i> Swipes 探索深度
          </div>
          <div class="sub-metrics-list">
            <div class="sub-metric-row">
              <span class="label">累计产生 Swipes 样本:</span>
              <strong class="val">${stats.swipes.totalSwipes} 次</strong>
            </div>
            <div class="sub-metric-row">
              <span class="label">单轮最高重试探索:</span>
              <strong class="val">${stats.swipes.maxSwipesOnTurn} 次</strong>
            </div>
            <div class="sub-metric-row">
              <span class="label">产生重试探索的轮次:</span>
              <strong class="val">${stats.swipes.turnsWithSwipes} 轮 (${stats.swipes.explorationRate}%)</strong>
            </div>
          </div>
        </div>

        <div class="analytics-section half">
          <div class="section-title">
            <i class="fa-solid fa-bookmark"></i> 剧情书签与里程碑
          </div>
          <div class="sub-metrics-list">
            <div class="sub-metric-row">
              <span class="label">书签标记关键节点:</span>
              <strong class="val">${stats.milestones.bookmarks} 处</strong>
            </div>
            <div class="sub-metric-row">
              <span class="label">自定义标签标注节点:</span>
              <strong class="val">${stats.milestones.taggedNodes} 处</strong>
            </div>
            <div class="sub-metric-row">
              <span class="label">平均单条消息长度:</span>
              <strong class="val">${stats.content.avgWordsPerTurn} 字</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- 高频剧情标签云 -->
      <div class="analytics-section">
        <div class="section-title">
          <i class="fa-solid fa-tags"></i> 高频剧情标签分布
        </div>
        <div class="analytics-tags-cloud">
          ${tagsHtml}
        </div>
      </div>
    </div>

    <div class="analytics-footer">
      <div class="footer-left-status">
        <span class="status-indicator">●</span> 已完成全量时间树拓扑与文本量化
      </div>
      <div class="footer-actions">
        <button class="analytics-btn secondary btn-copy-md" title="复制 Markdown 研报至剪贴板">
          <i class="fa-solid fa-copy"></i> 复制 Markdown
        </button>
        <button class="analytics-btn secondary btn-dl-md" title="下载 Markdown 研报文件">
          <i class="fa-solid fa-download"></i> 导出研报
        </button>
        <button class="analytics-btn secondary btn-dl-json" title="下载 JSON 数据">
          <i class="fa-solid fa-code"></i> 导出 JSON
        </button>
        <button class="analytics-btn primary btn-close">
          关闭
        </button>
      </div>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  activeModalElement = backdrop;

  // 绑定事件
  const closeBtn = modal.querySelector('.analytics-close-btn');
  const btnCloseBottom = modal.querySelector('.btn-close');
  const btnCopyMd = modal.querySelector('.btn-copy-md');
  const btnDlMd = modal.querySelector('.btn-dl-md');
  const btnDlJson = modal.querySelector('.btn-dl-json');

  const closeHandler = () => closeAnalyticsModal();
  closeBtn.addEventListener('click', closeHandler);
  btnCloseBottom.addEventListener('click', closeHandler);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeAnalyticsModal();
  });

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      closeAnalyticsModal();
      document.removeEventListener('keydown', onKeydown);
    }
  };
  document.addEventListener('keydown', onKeydown);

  // 复制 Markdown
  btnCopyMd.addEventListener('click', async () => {
    const md = formatAnalyticsMarkdown(stats);
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
      btnCopyMd.innerHTML = '<i class="fa-solid fa-check"></i> 已复制研报';
      setTimeout(() => {
        btnCopyMd.innerHTML = '<i class="fa-solid fa-copy"></i> 复制 Markdown';
      }, 2000);
    } catch (err) {
      console.error('[Timelines Analytics] 复制失败:', err);
    }
  });

  // 下载 Markdown
  btnDlMd.addEventListener('click', () => {
    const md = formatAnalyticsMarkdown(stats);
    const filename = `timeline-analytics-${Date.now()}.md`;
    downloadFile(md, filename, 'text/markdown;charset=utf-8');
  });

  // 下载 JSON
  btnDlJson.addEventListener('click', () => {
    const jsonStr = formatAnalyticsJson(stats);
    const filename = `timeline-analytics-${Date.now()}.json`;
    downloadFile(jsonStr, filename, 'application/json;charset=utf-8');
  });
}

/**
 * 关闭数据看板模态框
 */
export function closeAnalyticsModal() {
  if (activeModalElement) {
    try {
      activeModalElement.remove();
    } catch {
      // ignore
    }
    activeModalElement = null;
  }
}
