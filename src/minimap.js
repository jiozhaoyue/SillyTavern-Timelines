/**
 * @file minimap.js
 * 时间线全景小地图组件。
 * 采用顶部折叠抽屉设计，提供鸟瞰全景与视口拖拽/点击快速导航。
 */

import {
  calculateCenterPan,
  calculateProjection,
  canvasToModel,
  extentToCanvasRect,
  isPointInRect,
  modelToCanvas,
} from './minimap-math.js';

export class Minimap {
  /**
   * @param {Object} cy - Cytoscape 实例
   * @param {HTMLElement} parentContainer - 模态框内部容器 (如 #networkContainer)
   */
  constructor(cy, parentContainer) {
    this.cy = cy;
    this.parentContainer = parentContainer || document.getElementById('networkContainer') || document.body;
    this.drawerElement = null;
    this.canvas = null;
    this.ctx = null;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    this.isOpen = false;
    this.projection = null;
    this.currentViewportRect = null;
    this.isDragging = false;
    this.dragGrabOffset = { x: 0, y: 0 };
    this.rafId = null;
    this.cyHandlers = [];

    this.initDOM();
    this.bindEvents();
  }

  /**
   * 构建或复用顶部抽屉 DOM 结构
   */
  initDOM() {
    let drawer = this.parentContainer.querySelector('#timelinesMinimapDrawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'timelinesMinimapDrawer';
      drawer.className = 'timelines-minimap-drawer hidden';
      drawer.innerHTML = `
                <div class="minimap-drawer-inner">
                    <div class="minimap-header">
                        <span class="minimap-title"><i class="fa-solid fa-map"></i> 全景小地图</span>
                        <span class="minimap-stats" id="minimapStatsText"></span>
                        <button class="minimap-close-btn fa-solid fa-chevron-up" title="收起小地图"></button>
                    </div>
                    <div class="minimap-canvas-wrapper">
                        <canvas id="timelinesMinimapCanvas" width="600" height="120"></canvas>
                    </div>
                </div>
            `;

      // 插入在顶部控制按钮区下方
      const graphContainer = this.parentContainer.querySelector('.graph-container');
      if (graphContainer) {
        this.parentContainer.insertBefore(drawer, graphContainer);
      } else {
        this.parentContainer.appendChild(drawer);
      }
    }

    this.drawerElement = drawer;
    this.canvas = drawer.querySelector('#timelinesMinimapCanvas');
    this.ctx = this.canvas.getContext('2d');

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');

    drawer.querySelector('.minimap-close-btn').addEventListener('click', () => {
      this.hide();
    });
  }

  /**
   * 绑定 Cytoscape 与 Canvas 交互事件
   */
  bindEvents() {
    // 视口平移与缩放监听
    const onViewportChange = () => {
      if (this.isOpen) {
        this.scheduleRender();
      }
    };

    const onGraphTopologyChange = () => {
      if (this.isOpen) {
        this.renderBackground();
        this.scheduleRender();
      }
    };

    const onResize = () => {
      if (this.isOpen) {
        this.renderBackground();
        this.scheduleRender();
      }
    };

    this.cy.on('pan zoom', onViewportChange);
    this.cy.on('resize', onResize);
    this.cy.on('position add remove', onGraphTopologyChange);

    this.cyHandlers.push(
      { events: 'pan zoom', fn: onViewportChange },
      { events: 'resize', fn: onResize },
      { events: 'position add remove', fn: onGraphTopologyChange },
    );

    // Canvas 交互事件
    const getCanvasCoord = evt => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      return {
        x: (clientX - rect.left) * (this.canvas.width / rect.width),
        y: (clientY - rect.top) * (this.canvas.height / rect.height),
      };
    };

    const centerOnModelPoint = (modelPt, animate = false) => {
      const zoom = this.cy.zoom();
      const viewW = this.cy.width();
      const viewH = this.cy.height();
      const targetPan = calculateCenterPan(modelPt, zoom, viewW, viewH);

      if (animate) {
        this.cy.stop().animate({
          pan: targetPan,
          duration: 250,
        });
      } else {
        this.cy.pan(targetPan);
      }
    };

    const onPointerDown = evt => {
      if (!this.projection) return;
      const pt = getCanvasCoord(evt);
      const vpRect = this.currentViewportRect;

      if (vpRect && isPointInRect(pt, vpRect)) {
        // 点击在取景框内部：进入拖拽取景模式
        this.isDragging = true;
        const vpCenter = {
          x: vpRect.x + vpRect.width / 2,
          y: vpRect.y + vpRect.height / 2,
        };
        this.dragGrabOffset = {
          x: pt.x - vpCenter.x,
          y: pt.y - vpCenter.y,
        };
      } else {
        // 点击在取景框外部：直接居中跳转至点击的模型坐标
        const modelPt = canvasToModel(pt, this.projection);
        centerOnModelPoint(modelPt, true);
      }
    };

    const onPointerMove = evt => {
      if (!this.isDragging || !this.projection) return;
      evt.preventDefault();
      const pt = getCanvasCoord(evt);
      const targetCanvasCenter = {
        x: pt.x - this.dragGrabOffset.x,
        y: pt.y - this.dragGrabOffset.y,
      };
      const targetModelPt = canvasToModel(targetCanvasCenter, this.projection);
      centerOnModelPoint(targetModelPt, false);
    };

    const onPointerUp = () => {
      this.isDragging = false;
    };

    this.canvas.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    this.canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);

    this.unbindDomEvents = () => {
      this.canvas.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      this.canvas.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    };
  }

  /**
   * 绘制全图拓扑背景层（缓存到 offscreenCanvas）
   */
  renderBackground() {
    const nodes = this.cy.nodes();
    if (nodes.length === 0) return;

    const bounds = this.cy.elements().boundingBox();
    const wrapper = this.drawerElement.querySelector('.minimap-canvas-wrapper');
    const displayWidth = wrapper ? wrapper.clientWidth : 600;
    const width = Math.max(displayWidth, 200);
    const height = 120;

    this.canvas.width = width;
    this.canvas.height = height;
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;

    this.projection = calculateProjection(bounds, width, height, 12);

    const ctx = this.offscreenCtx;
    ctx.clearRect(0, 0, width, height);

    // 绘制背景
    ctx.fillStyle = 'rgba(15, 20, 30, 0.75)';
    ctx.fillRect(0, 0, width, height);

    // 绘制所有边（半透明线）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    this.cy.edges().forEach(edge => {
      const src = edge.source().position();
      const tgt = edge.target().position();
      const p1 = modelToCanvas(src, this.projection);
      const p2 = modelToCanvas(tgt, this.projection);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    // 绘制所有节点（微型彩色粒子）
    nodes.forEach(node => {
      const pos = node.position();
      const pt = modelToCanvas(pos, this.projection);
      const isUser = Boolean(node.data('is_user'));
      const isRoot = node.hasClass('rootNode');

      ctx.beginPath();
      if (isRoot) {
        ctx.fillStyle = '#f39c12';
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      } else if (isUser) {
        ctx.fillStyle = '#58a6ff';
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      } else {
        ctx.fillStyle = '#3fb950';
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      }
      ctx.fill();
    });

    const statsText = this.drawerElement.querySelector('#minimapStatsText');
    if (statsText) {
      statsText.textContent = `${nodes.length} 个节点 / ${this.cy.edges().length} 条边`;
    }
  }

  /**
   * 调度双缓冲复合绘制（背景 + 取景框）
   */
  scheduleRender() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      this.renderComposite();
    });
  }

  /**
   * 复合绘制当前帧
   */
  renderComposite() {
    if (!this.projection || !this.ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;

    this.ctx.clearRect(0, 0, width, height);
    // 贴上预渲染背景
    this.ctx.drawImage(this.offscreenCanvas, 0, 0);

    // 计算当前主图视口取景矩形
    const extent = this.cy.extent();
    const rect = extentToCanvasRect(extent, this.projection);
    this.currentViewportRect = rect;

    // 绘制取景框半透明填充
    this.ctx.fillStyle = 'rgba(88, 166, 255, 0.2)';
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    // 绘制取景框边线与发光
    this.ctx.strokeStyle = '#58a6ff';
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  /**
   * 展开全景小地图
   */
  show() {
    this.isOpen = true;
    this.drawerElement.classList.remove('hidden');
    const toggleBtn = this.parentContainer.querySelector('.toggle-minimap');
    if (toggleBtn) {
      toggleBtn.classList.add('active');
    }
    requestAnimationFrame(() => {
      this.renderBackground();
      this.scheduleRender();
    });
  }

  /**
   * 收起全景小地图
   */
  hide() {
    this.isOpen = false;
    this.drawerElement.classList.add('hidden');
    const toggleBtn = this.parentContainer.querySelector('.toggle-minimap');
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 切换展开/收起状态
   */
  toggle() {
    if (this.isOpen) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 销毁组件与解绑事件
   */
  destroy() {
    this.hide();
    if (this.unbindDomEvents) {
      this.unbindDomEvents();
    }
    this.cyHandlers.forEach(({ events, fn }) => {
      this.cy.off(events, fn);
    });
    if (this.drawerElement && this.drawerElement.parentNode) {
      this.drawerElement.parentNode.removeChild(this.drawerElement);
    }
  }
}
