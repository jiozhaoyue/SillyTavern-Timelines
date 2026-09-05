/**
 * @file export-modal.js
 * @description 交互式图谱导出与长图分享配置对话框
 */

import {
  exportTimelineAsPng,
  exportTimelineAsSvg,
  triggerDownload,
  copyBlobToClipboard,
  formatExportFilename,
} from './export-service.js';
import { escapeHtml } from './helpers.js';

/**
 * 打开导出时间线配置模态框
 *
 * @param {object} cy - Cytoscape 实例
 * @param {object} [context] - 当前酒馆运行上下文
 */
export function openExportModal(cy, context = null) {
  if (!cy) {
    toastr.warning('时间线尚未加载完成');
    return;
  }

  const existing = document.getElementById('timelines-export-backdrop');
  if (existing) existing.remove();

  const ctx = context || window.Luker?.getContext?.() || window.SillyTavern?.getContext?.();
  const characterName = ctx?.characters?.[ctx?.characterId]?.name || 'Timeline';
  const chatName = ctx?.chatId || ctx?.chatMetadata?.file_name || '';
  const totalNodes = cy.nodes().filter(n => !n.data('isCollapsedCluster') && n.data('label') !== 'root').length;

  const backdrop = document.createElement('div');
  backdrop.id = 'timelines-export-backdrop';
  backdrop.className = 'timelines-export-backdrop';

  const modal = document.createElement('div');
  modal.id = 'timelines-export-modal';
  modal.className = 'timelines-export-modal';

  modal.innerHTML = `
    <div class="timelines-export-header">
      <h3><i class="fa-solid fa-camera"></i> 导出时间线海报与长图</h3>
      <button class="timelines-export-close fa-solid fa-xmark" title="关闭"></button>
    </div>
    <div class="timelines-export-desc">
      将当前分叉树生成高保真长图海报或无损矢量图，方便在社区分享与长篇剧情归档。
    </div>

    <div class="timelines-export-section">
      <label class="timelines-export-label">导出格式与清晰度：</label>
      <div class="timelines-export-formats">
        <label class="tl-format-card">
          <input type="radio" name="tl_export_format" value="png-2x" checked />
          <div class="tl-format-content">
            <span class="tl-format-name">PNG 高清 (2x)</span>
            <span class="tl-format-hint">Retina 超清渲染，推荐分享</span>
          </div>
        </label>
        <label class="tl-format-card">
          <input type="radio" name="tl_export_format" value="png-1x" />
          <div class="tl-format-content">
            <span class="tl-format-name">PNG 标清 (1x)</span>
            <span class="tl-format-hint">体积小，普通设备预览</span>
          </div>
        </label>
        <label class="tl-format-card">
          <input type="radio" name="tl_export_format" value="png-4x" />
          <div class="tl-format-content">
            <span class="tl-format-name">PNG 超清 (4x)</span>
            <span class="tl-format-hint">印刷级超采样，适合超长树</span>
          </div>
        </label>
        <label class="tl-format-card">
          <input type="radio" name="tl_export_format" value="svg" />
          <div class="tl-format-content">
            <span class="tl-format-name">SVG 无损矢量</span>
            <span class="tl-format-hint">无限缩放不失真，二次排版</span>
          </div>
        </label>
      </div>
    </div>

    <div class="timelines-export-section tl-flex-row">
      <div>
        <label class="timelines-export-label">导出范围：</label>
        <select id="tl_export_scope" class="tl-select">
          <option value="full" selected>🌐 全部节点长卷 (Full Graph)</option>
          <option value="viewport">🔍 当前可见视口 (Viewport)</option>
        </select>
      </div>
      <div>
        <label class="timelines-export-label">画布背景：</label>
        <select id="tl_export_bg" class="tl-select">
          <option value="#0d1117" selected>⬛ 沉浸深黑 (#0d1117)</option>
          <option value="#1e293b">🔷 深板岩蓝 (#1e293b)</option>
          <option value="transparent">⬜ 透明背景 (Transparent)</option>
        </select>
      </div>
    </div>

    <div class="timelines-export-section">
      <label class="tl-checkbox-label">
        <input type="checkbox" id="tl_export_banner" checked />
        <span>附带剧本元数据水印底栏（包含角色名、总节点数、因果分支统计与时间戳）</span>
      </label>
    </div>

    <div class="timelines-export-actions">
      <button class="menu_button tl-btn-cancel">取消</button>
      <button class="menu_button tl-btn-copy"><i class="fa-solid fa-copy"></i> 复制到剪贴板</button>
      <button class="menu_button tl-btn-download" style="background:#0284c7;color:#fff;"><i class="fa-solid fa-download"></i> 下载图片文件</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // 关闭逻辑
  const close = () => backdrop.remove();
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  modal.querySelector('.timelines-export-close').onclick = close;
  modal.querySelector('.tl-btn-cancel').onclick = close;

  function getOptions() {
    const formatRadio = modal.querySelector('input[name="tl_export_format"]:checked');
    const format = formatRadio ? formatRadio.value : 'png-2x';
    const scope = modal.querySelector('#tl_export_scope').value;
    const bg = modal.querySelector('#tl_export_bg').value;
    const includeBanner = modal.querySelector('#tl_export_banner').checked;

    let scale = 2.0;
    if (format === 'png-1x') scale = 1.0;
    else if (format === 'png-4x') scale = 4.0;

    return {
      format,
      scale,
      full: scope === 'full',
      bg,
      includeBanner: format !== 'svg' && includeBanner,
      metadata: {
        characterName,
        chatName,
        totalNodes,
        totalBranches: Object.keys(ctx?.chatMetadata?.branches || {}).length || 1,
      },
    };
  }

  // 下载操作
  modal.querySelector('.tl-btn-download').onclick = async () => {
    const opts = getOptions();
    const btn = modal.querySelector('.tl-btn-download');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 渲染导出中...';

    try {
      if (opts.format === 'svg') {
        const svgBlob = exportTimelineAsSvg(cy, opts);
        const filename = formatExportFilename(characterName, 'svg');
        triggerDownload(svgBlob, filename);
        toastr.success('已开始下载 SVG 矢量图谱');
      } else {
        const pngBlob = await exportTimelineAsPng(cy, opts);
        const filename = formatExportFilename(characterName, 'png');
        triggerDownload(pngBlob, filename);
        toastr.success(`已生成 ${opts.scale}x 高清长图 (${Math.round(pngBlob.size / 1024)} KB)`);
      }
      close();
    } catch (err) {
      console.error('[Export] 导出图像失败:', err);
      toastr.error(`导出失败: ${err.message || err}`);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-download"></i> 下载图片文件';
    }
  };

  // 复制到剪贴板
  modal.querySelector('.tl-btn-copy').onclick = async () => {
    const opts = getOptions();
    const btn = modal.querySelector('.tl-btn-copy');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 复制中...';

    try {
      // 剪贴板统一使用 PNG 格式
      const pngBlob = await exportTimelineAsPng(cy, opts);
      await copyBlobToClipboard(pngBlob);
      toastr.success('已成功将时间线海报复制到剪贴板！');
      close();
    } catch (err) {
      console.warn('[Export] 复制到剪贴板受限:', err);
      toastr.warning(`无法写入剪贴板: ${err.message || '环境受限'}。已为您转为直接下载。`);
      try {
        const pngBlob = await exportTimelineAsPng(cy, opts);
        triggerDownload(pngBlob, formatExportFilename(characterName, 'png'));
      } catch (_) {}
      close();
    }
  };
}
