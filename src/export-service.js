/**
 * @file export-service.js
 * @description 超大画幅高保真图谱海报导出与长图分享引擎
 * 纯前端离线渲染，支持超采样位图 (PNG 1x/2x/4x)、无损矢量 (SVG) 与剧本元数据水印卡片合成。
 */

/**
 * 计算安全的图谱导出缩放倍率，防止浏览器 Canvas 超过 8192px 最大限制引发崩溃
 *
 * @param {number} boxWidth - 图谱原始包围盒宽度
 * @param {number} boxHeight - 图谱原始包围盒高度
 * @param {number} targetScale - 目标缩放倍率 (如 1.0, 2.0, 4.0)
 * @param {number} [maxDim=8192] - 允许的最大单边像素
 * @returns {number} 安全调整后的缩放倍率
 */
export function calculateSafeScale(boxWidth, boxHeight, targetScale = 1.0, maxDim = 8192) {
  const w = Math.max(1, Number(boxWidth) || 1);
  const h = Math.max(1, Number(boxHeight) || 1);
  const desiredScale = Math.max(0.1, Number(targetScale) || 1.0);

  const scaledW = w * desiredScale;
  const scaledH = h * desiredScale;

  if (scaledW <= maxDim && scaledH <= maxDim) {
    return desiredScale;
  }

  const maxAllowedScale = Math.min(maxDim / w, maxDim / h);
  return Math.max(0.1, maxAllowedScale);
}

/**
 * 格式化导出文件名
 * @param {string} characterName - 角色名
 * @param {string} [ext='png'] - 后缀
 * @returns {string}
 */
export function formatExportFilename(characterName = 'Timeline', ext = 'png') {
  const date = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  const safeName = (characterName || 'Timeline').replace(/[^\w\u4e00-\u9fa5-_]/g, '_');
  return `Timelines_${safeName}_${stamp}.${ext}`;
}

/**
 * 在图像底部离线拼接精致的剧情分叉树元数据水印卡片
 *
 * @param {HTMLCanvasElement|ImageBitmap} mainCanvas - 已渲染好的图谱主体画布
 * @param {object} metadata - 元数据
 * @param {string} [metadata.characterName] - 角色名
 * @param {string} [metadata.chatName] - 活跃会话名
 * @param {number} [metadata.totalNodes] - 总节点数
 * @param {number} [metadata.totalBranches] - 分支会话数
 * @param {string} [metadata.bgColor='#0d1117'] - 背景底色
 * @returns {HTMLCanvasElement} 拼接完成的合成画布
 */
export function composeMetadataBanner(mainCanvas, metadata = {}) {
  const bannerHeight = 80;
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = mainCanvas.width;
  finalCanvas.height = mainCanvas.height + bannerHeight;

  const ctx = finalCanvas.getContext('2d');
  if (!ctx) return mainCanvas;

  // 1. 填充全局背景底色
  ctx.fillStyle = metadata.bgColor || '#0d1117';
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

  // 2. 绘制主体图谱
  ctx.drawImage(mainCanvas, 0, 0);

  // 3. 绘制底部水印分隔线与渐变底栏
  const bannerY = mainCanvas.height;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bannerY);
  ctx.lineTo(finalCanvas.width, bannerY);
  ctx.stroke();

  // 底栏半透明背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, bannerY, finalCanvas.width, bannerHeight);

  // 4. 文字排版
  const paddingX = Math.min(32, finalCanvas.width * 0.04);
  const charName = metadata.characterName || 'SillyTavern';
  const chatName = metadata.chatName ? ` / ${metadata.chatName}` : '';
  const nodeCount = Number(metadata.totalNodes) || 0;
  const branchCount = Number(metadata.totalBranches) || 1;
  const timeStr = new Date().toLocaleString();

  // 左侧标题
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#f59e0b';
  ctx.fillText('⚡ SillyTavern Timelines · 剧情因果时间树', paddingX, bannerY + 32);

  ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(`🎭 角色：${charName}${chatName}`, paddingX, bannerY + 56);

  // 右侧统计与时间戳 (右对齐)
  ctx.textAlign = 'right';
  ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`📊 包含 ${nodeCount} 个剧情节点 · ${branchCount} 个因果分支`, finalCanvas.width - paddingX, bannerY + 32);
  ctx.fillText(`🕒 生成于 ${timeStr}`, finalCanvas.width - paddingX, bannerY + 56);

  // 重置对齐
  ctx.textAlign = 'left';

  return finalCanvas;
}

/**
 * 导出 Cytoscape 时间线图为高质量 PNG Blob
 *
 * @param {object} cy - Cytoscape 实例
 * @param {object} [options={}]
 * @param {number} [options.scale=2.0] - 缩放采样倍率 (1x/2x/4x)
 * @param {boolean} [options.full=true] - 是否全图导出 (false 则为当前视口)
 * @param {string} [options.bg='#0d1117'] - 背景底色
 * @param {boolean} [options.includeBanner=true] - 是否附带底部水印卡片
 * @param {object} [options.metadata={}] - 水印元数据
 * @returns {Promise<Blob>}
 */
export async function exportTimelineAsPng(cy, options = {}) {
  if (!cy || typeof cy.png !== 'function') {
    throw new Error('无效的 Cytoscape 实例或不支持 png 导出');
  }

  const full = options.full !== false;
  const desiredScale = Number(options.scale) || 2.0;
  const bg = options.bg || '#0d1117';

  // 1. 获取包围盒并计算安全缩放
  const bb = full ? cy.elements().boundingBox() : cy.extent();
  const safeScale = calculateSafeScale(bb.w, bb.h, desiredScale, 8192);

  // 2. 生成原始 Cytoscape PNG Base64
  const pngDataUri = cy.png({
    full,
    scale: safeScale,
    bg: bg === 'transparent' ? undefined : bg,
  });

  // 3. 如果无需水印卡片，直接转换为 Blob
  if (!options.includeBanner) {
    const res = await fetch(pngDataUri);
    return await res.blob();
  }

  // 4. 离线加载到 Image 并通过 Canvas 拼接元数据底栏
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = img.naturalWidth;
        offscreenCanvas.height = img.naturalHeight;
        const ctx = offscreenCanvas.getContext('2d');
        if (!ctx) {
          return fetch(pngDataUri).then(r => r.blob()).then(resolve);
        }
        ctx.drawImage(img, 0, 0);

        const composite = composeMetadataBanner(offscreenCanvas, {
          ...options.metadata,
          bgColor: bg,
        });

        composite.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob 转换失败'));
        }, 'image/png');
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('加载临时导出的 PNG 图像失败'));
    img.src = pngDataUri;
  });
}

/**
 * 导出 Cytoscape 时间线图为无损矢量 SVG
 *
 * @param {object} cy - Cytoscape 实例
 * @param {object} [options={}]
 * @param {boolean} [options.full=true]
 * @param {string} [options.bg='#0d1117']
 * @returns {Blob}
 */
export function exportTimelineAsSvg(cy, options = {}) {
  if (!cy) {
    throw new Error('无效的 Cytoscape 实例');
  }

  const full = options.full !== false;
  const bg = options.bg || '#0d1117';

  // 若环境已安装 cytoscape-svg 扩展，则优先使用其原生导出
  if (typeof cy.svg === 'function') {
    const svgString = cy.svg({
      full,
      bg: bg === 'transparent' ? undefined : bg,
    });
    return new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  }

  // 自主原生 SVG 矢量序列化生成器 (无任何外部 npm 扩展依赖)
  const eles = full ? cy.elements() : cy.elements().filter(e => typeof e.visible === 'function' ? e.visible() : true);
  const bb = full ? (typeof eles.boundingBox === 'function' ? eles.boundingBox() : { x1: 0, y1: 0, w: 600, h: 400 }) : (typeof cy.extent === 'function' ? cy.extent() : { x1: 0, y1: 0, w: 600, h: 400 });
  const pad = 40;
  const x = Math.floor((bb.x1 !== undefined ? bb.x1 : 0) - pad);
  const y = Math.floor((bb.y1 !== undefined ? bb.y1 : 0) - pad);
  const w = Math.max(100, Math.ceil((bb.w !== undefined ? bb.w : 600) + pad * 2));
  const h = Math.max(100, Math.ceil((bb.h !== undefined ? bb.h : 400) + pad * 2));

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">\n`;
  if (bg && bg !== 'transparent') {
    svgContent += `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>\n`;
  }

  // 1. 渲染连接边 (Edges)
  svgContent += '  <g id="timelines-edges">\n';
  const edges = typeof cy.edges === 'function' ? cy.edges() : [];
  edges.forEach(edge => {
    const srcNode = edge.source?.();
    const tgtNode = edge.target?.();
    if (!srcNode || !tgtNode) return;
    const src = srcNode.position?.() || { x: 0, y: 0 };
    const tgt = tgtNode.position?.() || { x: 0, y: 0 };
    const color = edge.style?.('line-color') || '#555555';
    const width = parseFloat(edge.style?.('width')) || 2;
    svgContent += `    <line x1="${src.x}" y1="${src.y}" x2="${tgt.x}" y2="${tgt.y}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>\n`;
  });
  svgContent += '  </g>\n';

  // 2. 渲染节点 (Nodes)
  svgContent += '  <g id="timelines-nodes">\n';
  const nodes = typeof cy.nodes === 'function' ? cy.nodes() : [];
  nodes.forEach(node => {
    const pos = node.position?.() || { x: 0, y: 0 };
    const width = node.width?.() || 30;
    const height = node.height?.() || 30;
    const bgColor = node.style?.('background-color') || '#ffffff';
    const borderColor = node.style?.('border-color') || '#333333';
    const borderWidth = parseFloat(node.style?.('border-width')) || 2;
    const label = node.data?.('label') || '';
    const shape = node.style?.('shape') || 'ellipse';

    if (shape === 'rectangle' || shape === 'round-rectangle') {
      svgContent += `    <rect x="${pos.x - width / 2}" y="${pos.y - height / 2}" width="${width}" height="${height}" rx="6" fill="${bgColor}" stroke="${borderColor}" stroke-width="${borderWidth}"/>\n`;
    } else {
      svgContent += `    <ellipse cx="${pos.x}" cy="${pos.y}" rx="${width / 2}" ry="${height / 2}" fill="${bgColor}" stroke="${borderColor}" stroke-width="${borderWidth}"/>\n`;
    }

    if (label && label !== 'root') {
      const safeLabel = String(label).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
      svgContent += `    <text x="${pos.x}" y="${pos.y + 4}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="11" fill="#e6edf3" text-anchor="middle">${safeLabel}</text>\n`;
    }
  });
  svgContent += '  </g>\n';
  svgContent += '</svg>\n';

  return new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * 触发浏览器原生下载 Blob 为本地文件
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 复制图像 Blob 到系统剪贴板 (Clipboard API)
 *
 * @param {Blob} blob - 必须为 image/png 格式
 * @returns {Promise<boolean>}
 */
export async function copyBlobToClipboard(blob) {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
    throw new Error('当前浏览器或连接环境不支持原生剪贴板写操作 (需要 HTTPS 或本地 localhost)');
  }

  const item = new ClipboardItem({ 'image/png': blob });
  await navigator.clipboard.write([item]);
  return true;
}
