/**
 * SillyTavern Timelines - Search Radar
 * 智能全景雷达与多维复合检索交互控制器
 * 
 * 职责：
 * 1. 增强现有 #transparent-search 输入框，注入雷达计数徽章与步进器。
 * 2. 挂载多维复合筛选气泡面板（角色、书签、标签、重试Swipes、楼层深度）。
 * 3. 结果集逐项跳跃遍历（Next/Prev）、平滑视口居中与脉冲聚焦。
 * 4. 非匹配节点与连线拓扑半透明调光与样式还原。
 */

import { filterGraphNodes } from './search-service.js';
import { debounce } from './helpers.js';

export class SearchRadar {
  /**
   * @param {object} cy Cytoscape 实例
   * @param {HTMLElement} container 拓扑图外部容器或工具栏父节点
   */
  constructor(cy, container = document) {
    this.cy = cy;
    this.container = container;
    this.matchedNodes = [];
    this.currentIndex = -1;

    this.filters = {
      query: '',
      speakerFilter: 'all',
      onlyBookmarks: false,
      onlyTagged: false,
      onlySwipes: false,
      minFloor: null,
      maxFloor: null,
    };

    this.initUI();
  }

  initUI() {
    const searchInput = this.container.querySelector('#transparent-search');
    if (!searchInput) return;

    this.searchInput = searchInput;

    // 检查是否已注入控件
    let radarWrapper = this.container.querySelector('.radar-controls-wrapper');
    if (!radarWrapper) {
      radarWrapper = document.createElement('div');
      radarWrapper.className = 'radar-controls-wrapper';

      radarWrapper.innerHTML = `
        <span class="radar-badge hidden">0/0</span>
        <button class="radar-btn btn-prev" title="上一个匹配项 [Shift+Enter]"><i class="fa-solid fa-chevron-up"></i></button>
        <button class="radar-btn btn-next" title="下一个匹配项 [Enter]"><i class="fa-solid fa-chevron-down"></i></button>
        <button class="radar-btn btn-filter" title="多维复合过滤筛选"><i class="fa-solid fa-sliders"></i></button>

        <!-- 复合筛选气泡面板 -->
        <div class="radar-filter-popover hidden">
          <div class="popover-header">
            <span><i class="fa-solid fa-filter"></i> 复合检索筛选</span>
            <button class="popover-close-btn"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="popover-body">
            <div class="filter-group">
              <label class="filter-group-label">说话人角色</label>
              <div class="filter-radio-row">
                <label><input type="radio" name="radar-speaker" value="all" checked /> 全部</label>
                <label><input type="radio" name="radar-speaker" value="user" /> 玩家</label>
                <label><input type="radio" name="radar-speaker" value="character" /> 角色</label>
              </div>
            </div>

            <div class="filter-group">
              <label class="filter-group-label">属性筛选</label>
              <div class="filter-checkbox-col">
                <label><input type="checkbox" class="chk-bookmark" /> 仅书签里程碑</label>
                <label><input type="checkbox" class="chk-tagged" /> 仅带彩色标签</label>
                <label><input type="checkbox" class="chk-swipes" /> 仅含分支重试 (Swipes > 1)</label>
              </div>
            </div>

            <div class="filter-group">
              <label class="filter-group-label">楼层深度范围</label>
              <div class="filter-range-row">
                <input type="number" class="floor-min" placeholder="Min" min="0" />
                <span>~</span>
                <input type="number" class="floor-max" placeholder="Max" min="0" />
              </div>
            </div>
          </div>
          <div class="popover-footer">
            <button class="popover-reset-btn">重置筛选</button>
          </div>
        </div>
      `;

      searchInput.parentNode.insertBefore(radarWrapper, searchInput.nextSibling);
    }

    this.wrapper = radarWrapper;
    this.badge = radarWrapper.querySelector('.radar-badge');
    this.btnPrev = radarWrapper.querySelector('.btn-prev');
    this.btnNext = radarWrapper.querySelector('.btn-next');
    this.btnFilter = radarWrapper.querySelector('.btn-filter');
    this.popover = radarWrapper.querySelector('.radar-filter-popover');

    this.bindEvents();
  }

  bindEvents() {
    // 搜索输入触发
    const onSearchDebounced = debounce(() => {
      this.filters.query = this.searchInput.value.trim();
      this.executeSearch();
    }, 200);

    this.searchInput.addEventListener('input', onSearchDebounced);

    // 快捷键 Enter / Shift+Enter / Escape
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.jumpPrev();
        } else {
          this.jumpNext();
        }
      } else if (e.key === 'Escape') {
        this.clear();
      }
    });

    // 步进器按钮
    this.btnPrev.addEventListener('click', () => this.jumpPrev());
    this.btnNext.addEventListener('click', () => this.jumpNext());

    // 气泡面板切换
    this.btnFilter.addEventListener('click', (e) => {
      e.stopPropagation();
      this.popover.classList.toggle('hidden');
    });

    this.popover.querySelector('.popover-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.popover.classList.add('hidden');
    });

    // 气泡面板筛选选项联动
    const radios = this.popover.querySelectorAll('input[name="radar-speaker"]');
    radios.forEach(r => r.addEventListener('change', (e) => {
      this.filters.speakerFilter = e.target.value;
      this.executeSearch();
    }));

    const chkBookmark = this.popover.querySelector('.chk-bookmark');
    chkBookmark.addEventListener('change', (e) => {
      this.filters.onlyBookmarks = e.target.checked;
      this.executeSearch();
    });

    const chkTagged = this.popover.querySelector('.chk-tagged');
    chkTagged.addEventListener('change', (e) => {
      this.filters.onlyTagged = e.target.checked;
      this.executeSearch();
    });

    const chkSwipes = this.popover.querySelector('.chk-swipes');
    chkSwipes.addEventListener('change', (e) => {
      this.filters.onlySwipes = e.target.checked;
      this.executeSearch();
    });

    const floorMin = this.popover.querySelector('.floor-min');
    const floorMax = this.popover.querySelector('.floor-max');
    floorMin.addEventListener('input', () => {
      this.filters.minFloor = floorMin.value;
      this.executeSearch();
    });
    floorMax.addEventListener('input', () => {
      this.filters.maxFloor = floorMax.value;
      this.executeSearch();
    });

    // 重置
    this.popover.querySelector('.popover-reset-btn').addEventListener('click', () => {
      radios[0].checked = true;
      chkBookmark.checked = false;
      chkTagged.checked = false;
      chkSwipes.checked = false;
      floorMin.value = '';
      floorMax.value = '';
      this.filters.speakerFilter = 'all';
      this.filters.onlyBookmarks = false;
      this.filters.onlyTagged = false;
      this.filters.onlySwipes = false;
      this.filters.minFloor = null;
      this.filters.maxFloor = null;
      this.executeSearch();
    });
  }

  hasActiveFilters() {
    return (
      Boolean(this.filters.query) ||
      this.filters.speakerFilter !== 'all' ||
      this.filters.onlyBookmarks ||
      this.filters.onlyTagged ||
      this.filters.onlySwipes ||
      (this.filters.minFloor != null && this.filters.minFloor !== '') ||
      (this.filters.maxFloor != null && this.filters.maxFloor !== '')
    );
  }

  executeSearch() {
    if (!this.cy) return;

    const cyNodes = typeof this.cy.nodes === 'function' ? this.cy.nodes().toArray() : [];

    if (!this.hasActiveFilters()) {
      this.restoreGraph();
      return;
    }

    const matchedEles = filterGraphNodes(cyNodes, this.filters);
    this.matchedNodes = matchedEles;

    if (this.matchedNodes.length === 0) {
      this.badge.classList.remove('hidden');
      this.badge.textContent = '0/0';
      this.currentIndex = -1;

      // 全部变暗
      this.cy.batch(() => {
        this.cy.elements().removeClass('search-matched search-current-focus');
        this.cy.elements().addClass('search-dimmed');
      });
      return;
    }

    this.badge.classList.remove('hidden');
    this.cy.batch(() => {
      this.cy.elements().removeClass('search-matched search-current-focus');
      this.cy.elements().addClass('search-dimmed');

      for (const node of this.matchedNodes) {
        if (typeof node.removeClass === 'function') {
          node.removeClass('search-dimmed');
          node.addClass('search-matched');
        }
      }
    });

    this.currentIndex = 0;
    this.focusCurrentMatch();
  }

  jumpNext() {
    if (this.matchedNodes.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.matchedNodes.length;
    this.focusCurrentMatch();
  }

  jumpPrev() {
    if (this.matchedNodes.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.matchedNodes.length) % this.matchedNodes.length;
    this.focusCurrentMatch();
  }

  focusCurrentMatch() {
    if (this.currentIndex < 0 || this.currentIndex >= this.matchedNodes.length) return;

    const node = this.matchedNodes[this.currentIndex];
    this.badge.textContent = `${this.currentIndex + 1}/${this.matchedNodes.length}`;

    if (this.cy && node && typeof node.renderedPosition === 'function') {
      this.cy.batch(() => {
        this.cy.nodes().removeClass('search-current-focus');
        node.addClass('search-current-focus');
      });

      this.cy.stop().animate({
        center: { eles: node },
        duration: 300,
      });

      if (typeof node.flashClass === 'function') {
        node.flashClass('timelines-node-pulse', 2000);
      }
    }
  }

  restoreGraph() {
    this.matchedNodes = [];
    this.currentIndex = -1;
    this.badge.classList.add('hidden');
    this.badge.textContent = '0/0';

    if (this.cy) {
      this.cy.batch(() => {
        this.cy.elements().removeClass('search-dimmed search-matched search-current-focus');
      });
    }
  }

  clear() {
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    this.filters.query = '';
    this.restoreGraph();
    if (this.popover) {
      this.popover.classList.add('hidden');
    }
  }
}
