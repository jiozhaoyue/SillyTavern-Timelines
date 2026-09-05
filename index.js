// @Technologicat 的 TODO，2024 年初：
// TODO: 热键（例如 Tab 跳转到匹配搜索的聊天分支）。

// @city-unit 原始 TODO：
// TODO: 边标签。
// TODO: 可能的小地图模式。
// TODO: 更多上下文菜单选项。
// TODO: 实验性多树视图。
// TODO: iOS 移动端点击。

const extensionName = 'SillyTavern-Timelines';
const settingsNamespace = 'SillyTavern-Timelines';
const legacySettingsNamespace = 'timeline';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}/`;

/**
 * 加载一个样式文件；如果已经加载过，就复用现有节点。
 *
 * @param {string} href - 样式文件路径。
 */
function loadStyle(href) {
  if (document.querySelector(`link[data-timelines-asset="${href}"]`)) {
    return;
  }

  const elem = document.createElement('link');
  elem.rel = 'stylesheet';
  elem.href = href;
  elem.dataset.timelinesAsset = href;
  document.head.appendChild(elem);
}

/**
 * 顺序加载脚本，避免 Cytoscape 插件早于 Cytoscape 本体执行。
 *
 * @param {string} src - 脚本路径。
 * @returns {Promise<void>} 脚本加载完成后 resolve。
 */
function loadScript(src) {
  if (document.querySelector(`script[data-timelines-asset="${src}"]`)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const elem = document.createElement('script');
    elem.src = src;
    elem.dataset.timelinesAsset = src;
    elem.onload = () => resolve();
    elem.onerror = () => reject(new Error(`Timelines: 无法加载脚本 ${src}`));
    document.head.appendChild(elem);
  });
}

[
  'vendor/cytoscape-context-menus.min.css',
  'vendor/light.min.css',
  'vendor/material.min.css',
  'vendor/light-border.min.css',
  'vendor/translucent.min.css',
  'vendor/tippy.css',
].forEach(path => loadStyle(`${extensionFolderPath}${path}`));

let vendorLoadError = null;
const vendorReady = (async () => {
  await loadScript(`${extensionFolderPath}vendor/cytoscape.min.js`);
  await loadScript(`${extensionFolderPath}vendor/dagre.js`);
  await loadScript(`${extensionFolderPath}vendor/cytoscape-dagre.min.js`);
  await loadScript(`${extensionFolderPath}vendor/tippy.umd.min.js`);
  await loadScript(`${extensionFolderPath}vendor/cytoscape-popper.min.js`);
  await loadScript(`${extensionFolderPath}vendor/cytoscape-context-menus.min.js`);
})().catch(error => {
  vendorLoadError = error;
  console.error('Timelines: 第三方依赖加载失败。', error);
});

import { event_types, eventSource, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

import { hideLoader, showLoader } from '../../../loader.js';
import { fixMarkdown } from '../../../power-user.js';
import { registerSlashCommand } from '../../../slash-commands.js';
import { delay } from '../../../utils.js';
import { timelinesCache } from './src/cache.js';
import { initContextMenu } from './src/context-menu.js';
import {
  getGraphOrientation,
  highlightMemoryMilestones,
  highlightNodesByQuery,
  makeQueryFragments,
  setGraphOrientationBasedOnViewport,
  toggleGraphOrientation,
} from './src/graph.js';
import { registerTimelinesExtensionApi, setTimelineGraphState } from './src/api.js';
import { buildMemoryIndexForGraph } from './src/memory-graph-service.js';
import { debounce, escapeHtml, escapeRegExp, makeContextKey } from './src/helpers.js';
import { layoutService } from './src/layout-service.js';
import { Minimap } from './src/minimap.js';
import { fetchData, prepareData } from './src/node-data.js';
import { highlightElements, restoreElements, setupStylesAndData } from './src/style.js';
import { closeModal, closeOpenDrawers, closeTippy, handleModalDisplay, navigateToMessage } from './src/utils.js';

registerTimelinesExtensionApi();

let defaultSettings = {
  nodeWidth: 25,
  nodeHeight: 25,
  nodeSeparation: 50,
  edgeSeparation: 10,
  rankSeparation: 50,
  spacingFactor: 1,
  fixedTooltip: false,
  fixedHoverTooltip: false,
  align: 'UL',
  nodeRanker: 'tight-tree',
  nodeShape: 'ellipse',
  curveStyle: 'taxi',
  swipeScale: false,
  avatarAsRoot: true,
  showLegend: true,
  bookmarkColor: '#ff0000',
  useChatColors: false,
  charNodeColor: '#FFFFFF',
  userNodeColor: '#ADD8E6',
  edgeColor: '#555',
  autoExpandSwipes: false,
  zoomToCurrentChatZoom: 1.0,
  enableMinZoom: true,
  minZoom: 0.1,
  enableMaxZoom: true,
  maxZoom: 3.0,
  gpuAcceleration: true,
};

let isLoadingSettings = false;
let currentlyHighlighted = null; // 当前高亮图例项对应的选择器
let lastContextKey = null; // 用来判断是否需要刷新图数据
let lastTimelineData = null; // 最近一次取回并整理好的时间线数据
let theCy = null; // Cytoscape 实例
let minimapInstance = null; // 全景小地图实例

let layout = {}; // Cytoscape 图布局配置；稍后由 `updateTimelineDataIfNeeded` 填充
let hasRegisteredContextInvalidators = false;
let uiEventAbortController = null;
let markdownConverter = null;
let hasRegisteredCytoscapePlugins = false;

/**
 * 优先使用 Luker 的全局上下文；在旧版 SillyTavern 中回退到导入的 `getContext()`。
 *
 * @returns {object} Luker/ST 上下文。
 */
function getTimelinesContext() {
  return window.Luker?.getContext?.() ?? getContext();
}

/**
 * 取得并迁移 Timelines 设置。新命名空间为插件目录名，旧 `timeline` 作为兼容别名。
 *
 * @returns {object} Timelines 设置对象。
 */
function getTimelineSettings() {
  if (!extension_settings[settingsNamespace]) {
    extension_settings[settingsNamespace] = {
      ...defaultSettings,
      ...(extension_settings[legacySettingsNamespace] ?? {}),
    };
  }
  extension_settings[legacySettingsNamespace] = extension_settings[settingsNamespace];
  return extension_settings[settingsNamespace];
}

/**
 * 从 Timelines 设置命名空间加载设置；缺失项用默认值补齐。
 *
 * 加载后同步更新设置面板控件。
 */
async function loadSettings() {
  const settings = getTimelineSettings();

  for (const [key, value] of Object.entries(defaultSettings)) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) {
      console.info(`Timelines: 设置默认值 ${key}`);
      settings[key] = value;
    }
  }

  isLoadingSettings = true;
  try {
    $('#tl_node_width').val(settings.nodeWidth).trigger('input');
    $('#tl_node_height').val(settings.nodeHeight).trigger('input');
    $('#tl_node_separation').val(settings.nodeSeparation).trigger('input');
    $('#tl_edge_separation').val(settings.edgeSeparation).trigger('input');
    $('#tl_rank_separation').val(settings.rankSeparation).trigger('input');
    $('#tl_spacing_factor').val(settings.spacingFactor).trigger('input');
    $('#tl_align').val(settings.align).trigger('input');
    $('#tl_tooltip_fixed').prop('checked', settings.fixedTooltip).trigger('input');
    $('#tl_hover_tooltip_fixed').prop('checked', settings.fixedHoverTooltip).trigger('input');
    $('#tl_gpu_acceleration').prop('checked', settings.gpuAcceleration).trigger('input');
    $('#tl_node_ranker').val(settings.nodeRanker).trigger('input');
    $('#tl_node_shape').val(settings.nodeShape).trigger('input');
    $('#tl_curve_style').val(settings.curveStyle).trigger('input');
    $('#tl_swipe_scale').prop('checked', settings.swipeScale).trigger('input');
    $('#tl_avatar_as_root').prop('checked', settings.avatarAsRoot).trigger('input');
    $('#tl_show_legend').prop('checked', settings.showLegend).trigger('input');
    $('#tl_use_chat_colors').prop('checked', settings.useChatColors).trigger('input');
    $('#tl_auto_expand_swipes').prop('checked', settings.autoExpandSwipes).trigger('input');
    $('#tl_zoom_current_chat').val(settings.zoomToCurrentChatZoom).trigger('input');
    $('#tl_zoom_min_cb').prop('checked', settings.enableMinZoom).trigger('input');
    $('#tl_zoom_min').val(settings.minZoom).trigger('input');
    $('#tl_zoom_min').prop('disabled', !settings.enableMinZoom);
    $('#tl_zoom_max_cb').prop('checked', settings.enableMaxZoom).trigger('input');
    $('#tl_zoom_max').val(settings.maxZoom).trigger('input');
    $('#tl_zoom_max').prop('disabled', !settings.enableMaxZoom);
    $('#bookmark-color-picker').attr('color', settings.bookmarkColor);
    $('#edge-color-picker').attr('color', settings.edgeColor);
    $('#user-node-color-picker').attr('color', settings.userNodeColor);
    $('#char-node-color-picker').attr('color', settings.charNodeColor);
  } finally {
    isLoadingSettings = false;
  }
}

let activeTapTippy = null; // 当前打开的完整信息面板实例
let currentlyOpenNode = null; // 当前完整信息面板所属的节点
let isTapTippyVisible = false; // 完整信息面板是否可见

/*
 * 关闭节点完整信息面板。
 */
function closeTapTippy() {
  if (activeTapTippy) {
    activeTapTippy.hide();
    activeTapTippy = null;
    isTapTippyVisible = false;
    currentlyOpenNode = null;
  }
}

/**
 * Determines preferred and fallback placements for a Tippy tooltip on a graph node.
 *
 * Accounts for graph orientation, and avoids covering those nearby nodes that are
 * most likely to be important.
 *
 * @param {Boolean} isSwipe - If true, get placements for a swipe node.
 *                            If false, get placements for a general node.
 * @returns {Object} - A dictionary with keys `preferred` and `fallback`.
 *                     The `fallback` item can be used with `popperOptions` to customize `flip`.
 *                     How to:
 *                       https://atomiks.github.io/tippyjs/v6/all-props/#placement
 *                       https://popper.js.org/docs/v2/modifiers/flip/
 */
function getNodeTippyPlacements(isSwipe) {
  const graphOrientation = getGraphOrientation();
  let placements = {};
  if (graphOrientation === 'LR') {
    // graph LR -> regular nodes left-to-right, swipes top-to-bottom
    if (!isSwipe) {
      // If possible, don't cover next/previous nodes on the same timeline. (top/bottom, try all alignments)
      // Then prefer to cover previous nodes (left), and finally, next nodes (right).
      // https://atomiks.github.io/tippyjs/#placements
      placements.preferred = 'top';
      placements.fallback = ['top-start', 'top-end', 'bottom', 'bottom-start', 'bottom-end', 'left', 'right'];
    } else {
      // If possible, don't cover other swipe nodes on the same message. (right/left, try all alignments)
      // Then prefer to cover previous swipes (top), and finally, next swipes (bottom).
      placements.preferred = 'right'; // don't cover other swipes
      placements.fallback = ['right-start', 'right-end', 'left', 'left-start', 'left-end', 'top', 'bottom'];
    }
  } else {
    // graph TB -> regular nodes top-to-bottom, swipes left-to-right
    if (!isSwipe) {
      placements.preferred = 'left';
      placements.fallback = ['left-start', 'left-end', 'right', 'right-start', 'right-end', 'top', 'bottom'];
    } else {
      placements.preferred = 'bottom';
      placements.fallback = ['bottom-start', 'bottom-end', 'top', 'top-start', 'top-end', 'left', 'right'];
    }
  }
  return placements;
}

/**
 * If a text search is active (the query in the UI is not blank), highlights matches in `text`
 * by adding HTML formatting. Uses the `timelines-text-search-match` class from the CSS.
 *
 * If no text search is active, returns `text` as-is.
 *
 * Designed for plain text input. Your mileage may vary, especially with HTML input
 * where the tags may trigger spurious matches.
 *
 * @param {string} text - The text to highlight matches in.
 * @returns {string} The same text, with search matches highlighted.
 */
function highlightTextSearchMatches(text) {
  const textSearchElement = document.getElementById('transparent-search');
  const query = textSearchElement.value.trim();
  if (query) {
    // Our text search uses the 'fragments' search mode.
    //
    // We match the fragments from longest to shortest. This prefers
    // the longest match when the fragments have common substrings.
    // For example, "laser las".
    //
    // Also we must match all fragments simultaneously, to avoid e.g. "las" matching
    // the "<font class=...>" inserted by this highlighter when it first highlights "laser".
    //
    const fragments = makeQueryFragments(query, false);
    fragments.sort(function (a, b) {
      return b.length - a.length;
    });
    const regEx = new RegExp(`(${fragments.map(escapeRegExp).join('|')})`, 'ig');

    // // This would be what to do in 'substring' search mode:
    // const regEx = new RegExp(query, "ig");

    text = text.replaceAll(regEx, '<font class="timelines-text-search-match">$1</font>');
  }
  return text;
}

/**
 * Creates a Tippy tooltip for a given Cytoscape element with specified content.
 *
 * @param {Object} ele - The Cytoscape element (node/edge) to attach the tooltip to.
 * @param {string} text - Optional. The content to be displayed inside the tooltip.
 *                        Beside this text, if any, instructions of what can be done
 *                        with the element are always displayed.
 * @param {Object} pos - Optional. Manual position for tooltip, in screen coordinates.
 *                       If not given, default is to position it near `ele`.
 * @returns {Object} - Returns the Tippy tooltip instance.
 */
function makeTippy(ele, text, pos) {
  const ref = getTooltipReference(ele, 'hover', pos);
  const isNode = ele.group() === 'nodes';
  const isSwipe = Boolean(ele.data('isSwipe')); // only used for nodes
  let placements;
  if (isNode) {
    placements = getNodeTippyPlacements(isSwipe);
  } else {
    placements = { preferred: 'top' }; // to avoid covering nodes on the same timeline
  }

  // 手动定位 tooltip，因此它没有真实目标元素。
  const dummyDomEle = document.createElement('div');

  const tip = tippy(dummyDomEle, {
    getReferenceClientRect: ref,
    trigger: 'manual',
    duration: 0, // No animation duration
    content: function () {
      const div = document.createElement('div');

      if (text) {
        const mesDiv = document.createElement('div');
        // 根节点没有消息，只有 AI 角色名，因此不应使用 `mes_text` class。
        // 这样可让根节点的 Tippy 与 TapTippy 布局一致。
        if (ele.data('msg')) {
          mesDiv.classList.add('mes_text');
        }
        mesDiv.innerHTML = text;
        div.appendChild(mesDiv);

        div.appendChild(document.createElement('hr'));
      }

      const instructionDiv = document.createElement('div');
      let instructionText = '<small><i>';
      if (isNode) {
        if (ele.data('id') === 'root') {
          instructionText += `此节点代表这组时间线中的 AI 角色${String(ele.data('name') ?? '').includes(', ') ? '们' : ''}。`;
        }
        if (isSwipe) {
          instructionText += '<b>此节点是一个 swipe。</b><br>';
        }
        if (ele.data('isBookmark')) {
          instructionText += `<b>此节点有检查点：</b><br>${escapeHtml(ele.data('bookmarkName'))}<br>`;
        }
        if (ele.data('totalSwipes') > 0) {
          instructionText += '<b>此节点有 swipes。</b>长按可切换显示。<br>';
        }
        if (ele.data('msg')) {
          instructionText += '点击打开完整信息和操作。<br>';
          instructionText += '双击快速打开第一个匹配的聊天。';
        }
        if (isSwipe) {
          instructionText += '<br>如果此 swipe 不在第一个匹配聊天的最后一条消息上，快速打开会创建新分支。';
        }
      } else {
        // edge
        instructionText += '点击沿边跳转。';
      }
      instructionText += '</i></small>';
      instructionDiv.innerHTML = instructionText;
      div.appendChild(instructionDiv);

      return div;
    },
    arrow: isNode, // The tooltip arrow pointing to the graph element only makes sense for a node.
    placement: extension_settings.timeline.fixedHoverTooltip ? 'top-start' : placements.preferred,
    hideOnClick: true,
    sticky: 'reference',
    interactive: true,
    appendTo: document.body,
  });

  return tip;
}

/**
 * Makes a Tippy tooltip for the given Cytoscape graph node.
 *
 * Side effect: stashes the tooltip instance as `node._tippy`, so it can be hidden later.
 *
 * @param {Object} node - The Cytoscape node.
 * @returns {Object} The Tippy tooltip.
 */
function makeNodeTippy(node) {
  // Return a truncated version of `msg` for use in a tooltip.
  const truncateMessage = (msg, length = 100) => {
    if (msg === undefined) {
      return '';
    }
    msg = msg.trim();
    if (msg.length <= length) {
      return msg;
    }
    // Truncate at a whole-word boundary, to show search highlights accurately (a single swoop fragment cannot span several words).
    // Also, trim extra whitespace while at it.
    const words = msg.split(/\s+/).map(function (str) {
      return str.trim();
    });
    let out = words[0];
    let j = 1;
    while (out.length < length - 3) {
      out = `${out} ${words[j]}`;
      j++;
    }
    return out + '...';
  };

  const truncatedMsg = formatNodeMessage(truncateMessage(node.data('msg')));
  const memPrefix = node.data('has_memory') ? '🧠 ' : '';
  let content = node.data('name') ? `<b>${memPrefix}${escapeHtml(node.data('name'))}</b> ${truncatedMsg}` : `${memPrefix}${truncatedMsg}`;
  content = highlightTextSearchMatches(content);
  const tippy = makeTippy(node, content);
  node._tippy = tippy; // Store the tippy instance on the graph element (so we can hide it later)
  return tippy;
}

/**
 * Formats a message for display within a node, handling special characters and Markdown conversion.
 *
 * @param {string} mes - The message to be formatted.
 * @returns {string} - The formatted message.
 *
 * Steps:
 * 1. Convert null messages to empty strings.
 * 2. Fix markdown-related content.
 * 3. Convert special characters to HTML entities.
 * 4. Format quotations and code snippets.
 * 5. Handle mathematical notation by converting LaTeX align environments to display math mode.
 * 6. Convert the message from markdown to HTML.
 * 7. Handle newlines and special characters within <code> tags.
 */

function formatNodeMessage(mes) {
  if (mes == null) return '';
  mes = fixMarkdown(mes);
  mes = mes.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  mes = mes.replace(/```[\s\S]*?```|``[\s\S]*?``|`[\s\S]*?`|(\".+?\")|(\u201C.+?\u201D)/gm, function (match, p1, p2) {
    if (p1) {
      return '<q>' + p1.replace(/\"/g, '') + '</q>';
    } else if (p2) {
      return '<q>“' + p2.replace(/\u201C|\u201D/g, '') + '”</q>';
    } else {
      return match;
    }
  });

  // 5. Handling mathematical notation
  mes = mes.replaceAll('\\begin{align*}', '$$').replaceAll('\\end{align*}', '$$');

  markdownConverter ??= new showdown.Converter({
    emoji: 'true',
    literalMidWordUnderscores: 'true',
    parseImgDimensions: 'true',
    tables: 'true',
  });

  mes = markdownConverter.makeHtml(mes);

  // 7. Handle <code> tags
  // TODO: Does this ever trigger? We replace < > a the beginning with HTML entities.
  // TODO: Is the opening tag matcher correct? If there are multiple `<code>...</code>` sections in the message, and the capture is greedy...
  mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, function (match) {
    return match.replace(/\n/gm, '\u0000');
  });
  mes = mes.replace(/\n/g, '<br/>');
  mes = mes.replace(/\u0000/g, '\n');
  mes = mes.trim();
  mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, function (match) {
    return match.replace(/&amp;/g, '&');
  });

  return mes;
}

/**
 * Creates a Tippy tooltip for a given Cytoscape node upon tapping.
 *
 * @param {Object} ele - The Cytoscape node for which the tooltip is being created.
 * @returns {Object} - The Tippy tooltip instance.
 *
 * The tooltip displays:
 * - Node name and send date.
 * - Swipes count, if any.
 * - Message content formatted using the `formatNodeMessage` function.
 * - A list of chat sessions associated with the node, with buttons to navigate to a session or branch from it.
 *
 * The tooltip's position, behavior, and style are also configured in this function.
 */

function makeTapTippy(ele) {
  const ref = getTooltipReference(ele, 'full_info_panel');
  const isSwipe = Boolean(ele.data('isSwipe'));
  const placements = getNodeTippyPlacements(isSwipe);

  // 手动定位 tooltip，因此它没有真实目标元素。
  const dummyDomEle = document.createElement('div');

  const tip = tippy(dummyDomEle, {
    getReferenceClientRect: ref,
    trigger: 'manual',
    duration: 0, // No animation duration
    content: function () {
      const div = document.createElement('div');
      div.classList.add('tap_tippy_content');

      // Set up the heading section
      const dataItems = [
        { content: ele.data('name'), className: 'name_text' },
        { content: ele.data('send_date'), className: 'timestamp' },
      ];
      if (ele.data('totalSwipes') > 0) {
        dataItems.push({ content: `Swipes：${ele.data('totalSwipes')}`, className: 'timestamp' });
      }

      // Build the HTML

      // Heading section
      dataItems.forEach(dataItem => {
        let p = document.createElement('div');
        p.classList.add(dataItem.className);
        p.textContent = dataItem.content ?? '';
        div.appendChild(p);
      });

      // --------------------------------------------------------------------------------

      // Add buttons: navigate to the message, create a new branch at the message
      if (ele.data('chat_sessions')) {
        div.appendChild(document.createElement('hr'));

        const menuDiv = document.createElement('div');
        menuDiv.classList.add('menu_div');

        for (const [file_name, session_metadata] of Object.entries(ele.data('chat_sessions')).reverse()) {
          // Create a container for the buttons
          const btnContainer = document.createElement('div');
          btnContainer.style.display = 'flex';

          // // Enable this if you want vertically centered buttons, where each button is sized separately to just accommodate its text content.
          // // If disabled, the buttons in each row auto-size vertically to have the same height with each other (tallest one wins).
          // btnContainer.style.alignItems = 'center';

          const sessionName = file_name.split('.jsonl')[0];
          const messageId = session_metadata.messageId; // sequential message number in chat
          const isLastMessage = messageId === session_metadata.length - 1; // in this chat session
          const isSwipe = Boolean(ele.data('isSwipe'));

          /**
           * Creates a Cytoscape selector that selects another message on the same timeline.
           *
           * @param {string} file_name - chat file name
           * @param {number} depthOffset - offset from current chat depth
           * @returns {Function} A Cytoscape selector that selects the matching node.
           */
          function makeTimelineNavigationMessageSelector(file_name, depthOffset) {
            const selector = function (ele) {
              if (ele.group() !== 'nodes') {
                return false;
              }
              const chat_depth = ele.data('chat_depth');
              const chat_sessions = ele.data('chat_sessions');
              const isSwipe = ele.data('isSwipe'); // this only exists (and is `true`) on swipe nodes
              if (chat_depth === undefined || chat_sessions === undefined) {
                // 根节点没有这些数据
                return false;
              }
              if (
                chat_depth === messageId + depthOffset &&
                !isSwipe &&
                Object.keys(chat_sessions).includes(file_name)
              ) {
                return true;
              }
              return false;
            };
            return selector;
          }

          /**
           * Creates an event listener function that navigates to another message on the same timeline.
           *
           * @param {Function} A Cytoscape selector that selects the desired node.
           * @returns {Function} An event listener that can be wired up to a 'click' event
           *                     that, when called, jumps to the node selected by the selector,
           *                     and opens its full info panel.
           */
          function makeTimelineNavigationClickListener(selector) {
            return function () {
              const newCenterNode = theCy.elements(selector);
              theCy.stop().animate({
                center: { eles: newCenterNode },
                zoom: Number(extension_settings.timeline.zoomToCurrentChatZoom),
                duration: 300, // Adjust the duration as needed for a smooth transition
              });
              tip.hide(); // Hide this full info panel
              flashNode(newCenterNode, 3, 250);
              newCenterNode.emit('tap'); // And open the info panel of the jumped-to node
            };
          }

          // 1. Previous message (on this timeline) button
          const prevBtn = document.createElement('button');
          prevBtn.classList.add('menu_button');
          prevBtn.classList.add('widthNatural');
          prevBtn.textContent = '<'; // ◀ triangle to the left
          prevBtn.title = `缩放到 "${sessionName}" 中的上一条消息。`; // TODO: data-i18n?
          const prevMessageSelector = makeTimelineNavigationMessageSelector(file_name, -1);
          prevBtn.addEventListener('click', makeTimelineNavigationClickListener(prevMessageSelector));
          if (isSwipe || messageId === 0) {
            prevBtn.disabled = true;
            prevBtn.classList.add('disabled');
          }
          btnContainer.appendChild(prevBtn);

          // 2. Next message (on this timeline) button
          const nextBtn = document.createElement('button');
          nextBtn.classList.add('menu_button');
          nextBtn.classList.add('widthNatural');
          nextBtn.textContent = '>'; // ▶ triangle to the right
          nextBtn.title = `缩放到 "${sessionName}" 中的下一条消息。`; // TODO: data-i18n?
          const nextMessageSelector = makeTimelineNavigationMessageSelector(file_name, 1);
          nextBtn.addEventListener('click', makeTimelineNavigationClickListener(nextMessageSelector));
          if (isSwipe || isLastMessage) {
            nextBtn.disabled = true;
            nextBtn.classList.add('disabled');
          }
          btnContainer.appendChild(nextBtn);

          // 3. Main button (open this chat)
          const navigateBtn = document.createElement('button');
          navigateBtn.classList.add('menu_button');
          navigateBtn.textContent = sessionName;
          navigateBtn.title = `Find and open this message in "${sessionName}".`; // TODO: data-i18n?
          navigateBtn.addEventListener('click', function () {
            if (ele.data('isSwipe')) {
              navigateToMessage(file_name, messageId, ele.data('swipeId'));
            } else {
              navigateToMessage(file_name, messageId);
            }
            closeModal();
            tip.hide(); // Hide this full info panel
            resetLegendHighlight(theCy); // Reset the legend highlight state
            restoreElements(theCy); // Remove remaining highlights, if any (from text search)
          });
          // Without creating a branch, swipes are available only at the last message of a chat.
          if (isSwipe && !isLastMessage) {
            navigateBtn.disabled = true;
            navigateBtn.classList.add('disabled');
          }
          btnContainer.appendChild(navigateBtn);

          // 4. Branch button (branch a new chat at this node)
          const branchBtn = document.createElement('button');
          branchBtn.classList.add('branch_button'); // You might want to style this button differently in your CSS
          branchBtn.textContent = '→'; // Arrow to the right
          branchBtn.classList.add('menu_button');
          branchBtn.classList.add('widthNatural');
          branchBtn.title = `Create a new branch from "${sessionName}", at this message, and open it.`; // TODO: data-i18n?
          branchBtn.addEventListener('click', function () {
            if (ele.data('isSwipe')) navigateToMessage(file_name, messageId, ele.data('swipeId'), true);
            else navigateToMessage(file_name, messageId, null, true);
            closeModal();
            tip.hide(); // Hide this full info panel
            resetLegendHighlight(theCy); // Reset the legend highlight state
            restoreElements(theCy); // Remove remaining highlights, if any (from text search)
          });
          btnContainer.appendChild(branchBtn);

          // Append the container to the menuDiv
          menuDiv.appendChild(btnContainer);
        }

        div.appendChild(menuDiv);
      }

      // --------------------------------------------------------------------------------
      div.appendChild(document.createElement('hr'));

      // Add the message content.
      const mesDiv = document.createElement('div');
      let formattedMsg;
      if (ele.data('msg')) {
        mesDiv.classList.add('mes_text');
        formattedMsg = formatNodeMessage(ele.data('msg'));
        formattedMsg = highlightTextSearchMatches(formattedMsg);
      } else if (ele.data('id') === 'root') {
        // 根节点没有消息，只有 AI 角色名，因此不应使用 `mes_text` class。
        // 这样可让根节点的 Tippy 与 TapTippy 布局一致。
        formattedMsg = `<small><i>此节点代表这组时间线中的 AI 角色${String(ele.data('name') ?? '').includes(', ') ? '们' : ''}。</i></small>`;
      }
      mesDiv.innerHTML = formattedMsg;
      div.appendChild(mesDiv);

      // 关联记忆卡片展示 (Memory Graph)
      const memoryBundle = ele.data('memoryBundle');
      if (memoryBundle && memoryBundle.event) {
        const memCard = document.createElement('div');
        memCard.classList.add('node-memory-card');

        const injectionStatus = ele.data('injectionStatus') || 'none';
        let statusBadge = '<span class="memory-badge badge-none">未激活</span>';
        if (injectionStatus === 'recall') {
          statusBadge = '<span class="memory-badge badge-recall">本轮已召回注入</span>';
        } else if (injectionStatus === 'always') {
          statusBadge = '<span class="memory-badge badge-always">持久置顶注入</span>';
        }

        const evt = memoryBundle.event;
        const locTitle = memoryBundle.location ? (memoryBundle.location.title || memoryBundle.location.id) : '';
        const charsList = (memoryBundle.characters || []).map(c => c.title || c.id).join('、');

        memCard.innerHTML = `
          <div class="node-memory-header">
            <span>🧠 关联长期记忆</span>
            ${statusBadge}
          </div>
          <div class="node-memory-title">${escapeHtml(evt.title || '记忆事件')}</div>
          <div class="node-memory-summary">${escapeHtml(evt.fields?.summary || evt.summary || '')}</div>
          <div class="node-memory-meta">
            ${locTitle ? `<span>📍 ${escapeHtml(locTitle)}</span>` : ''}
            ${charsList ? `<span>👥 ${escapeHtml(charsList)}</span>` : ''}
          </div>
        `;
        div.appendChild(memCard);
      }

      return div;
    },
    arrow: true,
    placement: extension_settings.timeline.fixedTooltip ? 'top-start' : placements.preferred,
    hideOnClick: false,
    sticky: 'reference',
    interactive: true,
    appendTo: document.body,
    boundary: document.querySelector('#timelinesDiagramDiv'),
    onShow() {
      isTapTippyVisible = true;
    },
    onHide() {
      isTapTippyVisible = false;
      console.debug('Timelines: 完整信息面板已隐藏。');
    },
    popperOptions: {
      modifiers: [
        {
          name: 'preventOverflow',
          options: {
            boundary: document.querySelector('#timelinesDiagramDiv'),
          },
        },
        {
          name: 'flip',
          options: {
            boundary: document.querySelector('#timelinesDiagramDiv'),
            fallbackPlacements: placements.fallback,
          },
        },
        {
          name: 'computeStyles',
          options: {
            adaptive: true,
            gpuAcceleration: extension_settings.timeline.gpuAcceleration,
            zIndex: 9999,
          },
        },
      ],
    },
  });

  return tip;
}

/**
 * Creates and populates a legend for nodes and edges in a Cytoscape graph.
 *
 * This function works in the following steps:
 * 1. Clears any existing legends in the specified container.
 * 2. Iterates over all nodes in the graph:
 *    - If a node with a unique name is found, its details (name and color)
 *      are added to the legend under the 'Nodes Legend' category.
 * 3. Iterates over all edges in the graph:
 *    - If an edge with a unique color is found, its details (checkpoint name and color)
 *      are added to the legend under the 'Edges Legend' category.
 *
 * @param {Object} cy - The Cytoscape instance where graph operations are performed.
 */
function createLegend(cy) {
  const legendContainer = document.getElementById('legendDiv');
  // Clear existing legends
  legendContainer.innerHTML = '';

  // Nodes Legend
  let nodeNames = new Set(); // Use a set to avoid duplicate names

  cy.nodes().forEach(node => {
    let name = node.data('name');
    let color = node.style('background-color');

    // If the name is defined and is not yet in the set
    if (name && !nodeNames.has(name)) {
      nodeNames.add(name);
      createLegendItem(
        cy,
        legendContainer,
        { color, text: name, class: name.replace(/\s+/g, '-').toLowerCase() },
        'circle',
      );
    }
  });

  // Edges Legend
  let edgeColors = new Map(); // Use a map to avoid duplicate colors and store associated names

  cy.edges().forEach(edge => {
    let color = edge.data('color');
    let bookmarkName = edge.data('bookmarkName');

    // If the color is defined and is not yet in the map
    if (color && !edgeColors.has(color)) {
      edgeColors.set(color, bookmarkName); // Set the color as key and bookmarkName as its value
      createLegendItem(
        cy,
        legendContainer,
        { color, text: bookmarkName || `${color} 的路径`, colorKey: color },
        'line',
      );
    }
  });
}

/**
 * Creates and appends a legend item to the provided container based on the item's type and details.
 *
 * This function performs the following tasks:
 * 1. Constructs the legend item and its corresponding visual symbol.
 * 2. Binds mouseover, mouseout, and click events to the legend item:
 *    - `mouseover`: Highlights corresponding elements on the Cytoscape graph to preview the legend item's representation.
 *    - `mouseout`: Restores graph elements to their original state after the preview unless the legend item is selected (locked).
 *    - `click`: Toggles the highlighting (locking/unlocking) of graph elements corresponding to the legend item.
 * 3. Sets visual styles for the legend symbol based on the item type.
 * 4. Appends the constructed legend item to the provided container.
 *
 * @param {Object} cy - The Cytoscape instance where graph operations are performed.
 * @param {HTMLElement} container - The container element to which the legend item will be appended.
 * @param {Object} item - The legend item details with `text` and `color` or `colorKey` properties.
 * @param {string} type - The type of legend item; can be either 'circle' for nodes or 'line' for edges.
 */
function createLegendItem(cy, container, item, type) {
  const legendItem = document.createElement('div');
  legendItem.className = 'legend-item';

  const legendSymbol = document.createElement('div');
  legendSymbol.className = 'legend-symbol';

  const selector = type === 'circle' ? `node[name="${item.text}"]` : `edge[color="${item.colorKey}"]`;

  // Mouseover for a preview
  legendItem.addEventListener('mouseover', function () {
    if (!legendItem.classList.contains('active-legend') && currentlyHighlighted !== selector) {
      highlightElements(cy, selector);
    }
  });

  // Mouseout to remove the preview, but keep it if clicked (locked)
  legendItem.addEventListener('mouseout', function () {
    if (!legendItem.classList.contains('active-legend') && currentlyHighlighted !== selector) {
      restoreElements(cy);
    }
  });

  // 点击可锁定或解除锁定视图。
  legendItem.addEventListener('click', function () {
    const differentLegendItemClicked = Boolean(currentlyHighlighted !== selector);

    resetLegendHighlight(cy); // Reset previous legend highlight, if any

    if (differentLegendItemClicked) {
      highlightElements(cy, selector);
      legendItem.classList.add('active-legend');
      currentlyHighlighted = selector;
    }

    // 缩放到高亮元素；没有高亮时缩放回全图。
    const [eles, padding] = filterElementsAndPad(cy, currentlyHighlighted);
    cy.stop().animate({
      fit: { eles: eles, padding: padding },
      duration: 300,
    });
  });

  if (type === 'circle') {
    legendSymbol.style.backgroundColor = item.color;
  } else if (type === 'line') {
    legendSymbol.style.borderTop = `3px solid ${item.color}`;
    legendSymbol.style.height = '5px';
    legendSymbol.style.width = '25px';
  }

  const legendText = document.createElement('div');
  legendText.className = 'legend-text';
  if (item.text.includes(' - ')) {
    // Omit the chat file timestamp, but keep the rest.
    legendText.innerText = item.text.split(' - ').slice(0, -1).join(' - ');
  } else {
    legendText.innerText = item.text;
  }

  legendItem.appendChild(legendSymbol);
  legendItem.appendChild(legendText);

  container.appendChild(legendItem);
}

/**
 * Resets the legend highlight (from clicking on a legend item).
 *
 * @param {Object} cy - The Cytoscape instance where graph operations are performed.
 */
function resetLegendHighlight(cy) {
  if (currentlyHighlighted) {
    restoreElements(cy);
    const activeItems = document.querySelectorAll('.active-legend');
    activeItems.forEach(item => item.classList.remove('active-legend'));
    currentlyHighlighted = null;
  }
}

/**
 * Selects elements for zooming to fit, and calculates the `padding` parameter for Cytoscape.
 * This is the higher-level function that uses `calculateFitZoom`, which see.
 *
 * Leaves one node size of padding if zoomed in (= 100% or closer), and 20px otherwise.
 *
 * @param {Object} cy - The Cytoscape instance.
 * @param {Object} selector - Anything `cy.filter` accepts. The thing(s) being zoomed to fit.
 *                            使用 `undefined` 表示选择整张图。
 */
function filterElementsAndPad(cy, selector) {
  let padding = 20;
  let eles;
  if (!selector) {
    eles = cy.filter(); // zoom out (select all elements) if no selector (empty query)
  } else {
    eles = cy.filter(selector);
    if (eles.length === 0) {
      eles = cy.filter(); // zoom out (select all elements) if the selector didn't match
    }
  }
  if (eles.length > 0) {
    // if the graph is not empty
    const zoomToFit = calculateFitZoom(cy, eles);
    if (zoomToFit >= 1.0) {
      // Compute the size of one node, in rendered pixels, at the zoom level that would be required to fit the selected content exactly.
      const nodeWidthRendered = zoomToFit * extension_settings.timeline.nodeWidth;
      const nodeHeightRendered = zoomToFit * extension_settings.timeline.nodeHeight;
      padding = Math.min(nodeWidthRendered, nodeHeightRendered); // arbitrary, but maybe better than max

      // Limit padding so that at least one node always fits into the viewport, regardless of how far in we try to zoom.
      // This prevents the graph from zooming out due to an insane theoretical amount of padding (more than viewport size)
      // when the auto-zoom zooms in really close.
      //
      // In practice: if one node would take >= 34% of horizontal or vertical viewport space, reserve 33% of the smaller
      // viewport dimension for padding on each side, to clamp the size of one node along that dimension to at most 34%.
      // This limits the size of one node to ~one third of the viewport size.
      const view_w = cy.width();
      const view_h = cy.height();
      if (nodeWidthRendered >= 0.34 * view_w || nodeHeightRendered >= 0.34 * view_h) {
        padding = Math.min(0.33 * view_w, 0.33 * view_h);
      }
    }
  }
  return [eles, padding];
}

/**
 * Calculates the zoom level needed to exactly fit the specified thing to the Cytoscape viewport.
 *
 * This can be used as an adapter for computing padding sizes in *model* pixels when zooming to fit
 * in Cytoscape, because the 'fit' operations only accept padding sizes in *rendered* pixels.
 *
 * @param {Object} cy - The Cytoscape instance.
 * @param {Object} eles - Result from `cy.filter`. The thing(s) being zoomed to fit.
 *                        We require calling `cy.filter` manually so that `eles` can be re-used
 *                        in the actual zooming call.
 * @returns {number} Returns the zoom-to-fit zoom level as a number.
 */
function calculateFitZoom(cy, eles) {
  const bb = eles.boundingBox();
  const view_w = cy.width();
  const view_h = cy.height();
  const zoomToFit_w = view_w / bb.w;
  const zoomToFit_h = view_h / bb.h;
  let zoomToFit = Math.min(zoomToFit_w, zoomToFit_h);
  // If we are applying min/max zoom (via `cy.minZoom`/`cy.maxZoom`), Cytoscape will respect that, so we should too.
  if (extension_settings.timeline.enableMinZoom && zoomToFit < Number(extension_settings.timeline.minZoom)) {
    zoomToFit = Number(extension_settings.timeline.minZoom);
  }
  if (extension_settings.timeline.enableMaxZoom && zoomToFit > Number(extension_settings.timeline.maxZoom)) {
    zoomToFit = Number(extension_settings.timeline.maxZoom);
  }
  return zoomToFit;
}

/**
 * Initializes a Cytoscape instance with given node data and styles.
 *
 * This function does the following:
 * 1. Locates the container element 'timelinesDiagramDiv' for the Cytoscape graph.
 * 2. Registers the necessary plugins: 'cytoscapeDagre', 'cytoscapeContextMenus', and 'cytoscapePopper'.
 * 3. Creates and configures the Cytoscape instance with the provided node data, styles, and layout settings.
 * 4. Adjusts wheel sensitivity for zooming operations on the graph.
 *
 * @param {Array<Object>} nodeData - Array of node data objects containing information required to render nodes and edges.
 * @param {Array<Object>} styles - Array of style definitions for nodes, edges, and other graph elements.
 * @returns {Object|null} Returns the Cytoscape instance if initialization is successful, otherwise returns null.
 */
function initializeCytoscape(nodeData, styles, layoutConfig = layout) {
  let timelinesDiagramDiv = document.getElementById('timelinesDiagramDiv');
  if (!timelinesDiagramDiv) {
    console.error('Timelines: 找不到 id 为 "timelinesDiagramDiv" 的元素。请确认调用时该元素已经存在。');
    return null;
  }

  if (!hasRegisteredCytoscapePlugins) {
    cytoscape.use(cytoscapeDagre);
    cytoscape.use(cytoscapeContextMenus);
    cytoscape.use(cytoscapePopper);
    hasRegisteredCytoscapePlugins = true;
  }

  const cy = cytoscape({
    container: timelinesDiagramDiv,
    elements: nodeData,
    style: styles,
    layout: layoutConfig,
    wheelSensitivity: 0.2, // Adjust as needed.
    textureOnViewport: true,
    hideEdgesOnViewport: true,
    pixelRatio: 'auto',
    touchTapThreshold: 10, // 优化移动端触控容错，防止微颤被误判为平移
    desktopTapThreshold: 4,
    boxSelectionEnabled: false, // 禁用框选手势，避免与移动端单指平移冲突
    autoungrabify: true, // 锁定节点绝对位置，防止触屏拖拽画布时误拖动单个节点
  });
  theCy = cy;
  window.theCy = cy;

  return cy;
}

/**
 * Gets the client bounding rectangle of the element with the id 'fixedReference'.
 *
 * @returns {DOMRect} - The client bounding rectangle of the specified element.
 */
function getFixedReferenceClientRect() {
  return document.querySelector('#fixedReference').getBoundingClientRect();
}

/**
 * Determines the reference position for the tooltip based on the configuration settings.
 *
 * @param {Object} ele - The Cytoscape element (node/edge) for which the tooltip reference is being determined.
 * @param {string} kind - Tooltip kind: one of "hover", "full_info_panel".
 * @param {Object} pos - Optional. Manual position for tooltip, in screen coordinates.
 *                       If not given, default is to position it near `ele`.
 * @returns {Function} - A function returning the client bounding rectangle of the reference element.
 *
 * If the fixedTooltip setting is enabled, the reference is the bottom-left corner of the screen;
 * otherwise, it is the position of the provided Cytoscape element.
 */
function getTooltipReference(ele, kind, pos) {
  const fixedPosition =
    kind === 'hover' ? extension_settings.timeline.fixedHoverTooltip : extension_settings.timeline.fixedTooltip;
  if (fixedPosition) {
    // TODO: No idea why we need to wrap this into a function instead of just returning the bound method itself
    //       (maybe the query selector instance gets GC'd too early?), but there you have it.
    return getFixedReferenceClientRect; // 参考点：固定在左下角的零尺寸 div（见 `settings.html`）
  } else if (pos) {
    // Manually specified position
    return () => ({
      width: 0,
      height: 0,
      left: pos.x,
      right: pos.x,
      top: pos.y,
      bottom: pos.y,
    });
  } else {
    return ele.popperRef().getBoundingClientRect; // The graph element's position
  }
}

/**
 * Toggles the display of swipe nodes in the Cytoscape graph.
 *
 * @param {Object} cy - The Cytoscape instance.
 * @param {Boolean} visible - Optional; if given, set the swipe node visible state instead of toggling it.
 *
 * When showing, swipe nodes are added to the graph using the stored data in the parent nodes.
 * When hiding, swipe nodes are removed along with their connected edges.
 */

function toggleSwipes(cy, visible) {
  // Check if there's any swipe node in the graph
  const swipeNodes = cy.nodes('[?isSwipe]');
  const wasVisible = Boolean(swipeNodes.length > 0);

  if (wasVisible) {
    // Remove all old swipe nodes and edges, if any
    swipeNodes.connectedEdges().remove();
    swipeNodes.remove();
  }

  if (visible === undefined) {
    // 未指定新的 `visible` 状态时执行切换
    visible = !wasVisible;
  }

  if (visible) {
    cy.nodes().forEach(node => {
      const storedSwipes = node.data('storedSwipes');
      if (storedSwipes && storedSwipes.length > 0) {
        storedSwipes.forEach(({ node: swipeNode, edge: swipeEdge }) => {
          cy.add({ group: 'nodes', data: swipeNode });
          cy.add({ group: 'edges', data: swipeEdge });
        });
      }
    });
  }
}

/**
 * Fixes the graph root node ending up in the stratosphere when there are lots of chats.
 *
 * @param {Object} cy - The Cytoscape instance.
 */
function fixRootNodePosition(cy) {
  console.debug('Timelines: 正在修正根节点位置。');
  const rootNode = cy.elements('node[id="root"]')[0]; // array of matches -> take first one (there is only one!)
  if (!rootNode) {
    return;
  }
  const outgoingEdgesFromRoot = cy.elements('edge[source="root"]');
  let greetingNodes = new Set(
    outgoingEdgesFromRoot.map(function (edge) {
      const nodeId = edge.data('target');
      const matchingNodes = cy.elements(`node[id="${nodeId}"]`);
      const node = matchingNodes[0];
      return node;
    }),
  );
  greetingNodes = [...greetingNodes].filter(Boolean); // set -> array
  if (greetingNodes.length === 0) {
    return;
  }

  function argMin(a) {
    return a.reduce((iBest, x, i, arr) => (x < arr[iBest] ? i : iBest), 0);
  }

  const graphOrientation = getGraphOrientation();
  if (graphOrientation === 'LR') {
    const greetingNodeYCoords = greetingNodes.map(node => node.position('y'));
    const topmostGreetingNodeIndex = argMin(greetingNodeYCoords);
    const topmostGreetingNode = greetingNodes[topmostGreetingNodeIndex];
    rootNode.unlock();
    rootNode.position('y', topmostGreetingNode.position('y'));
    rootNode.lock();
  } else {
    // graphOrientation === 'TB'
    const greetingNodeXCoords = greetingNodes.map(node => node.position('x'));
    const leftmostGreetingNodeIndex = argMin(greetingNodeXCoords);
    const leftmostGreetingNode = greetingNodes[leftmostGreetingNodeIndex];
    rootNode.unlock();
    rootNode.position('x', leftmostGreetingNode.position('x'));
    rootNode.lock();
  }
}

/**
 * Sets up event handlers for the given Cytoscape instance and node data.
 *
 * This function does the following:
 * 1. Attaches an event listener to the 'input' event of the search field to enable node highlighting based on search query.
 * 2. Adds an event listener to handle node clicks, triggering actions like node navigation.
 * 3. Configures the graph's orientation based on the viewport dimensions.
 * 4. Implements a delay for displaying tooltips on node hover, showcasing truncated node messages.
 *
 * @param {Object} cy - The Cytoscape instance for which the event handlers are being set up.
 * @param {Array<Object>} nodeData - Array of node data objects containing information like chat sessions.
 */
function setupEventHandlers(cy, nodeData) {
  let hasSetOrientation = false; // Ensure we set the graph orientation only once
  let showTimeout; // for the tooltip

  // Re-run the graph layout (needed whenever nodes are added/removed)
  function refreshLayout() {
    layout.fit = false;
    const cyLayout = cy.elements().makeLayout(layout); // TODO: 与 `cy.layout(layout)` 的差异需要继续确认（见 `src/graph.js` 的 `setOrientation`）。

    cy.nodes().forEach(node => {
      node.unlock();
    });
    cyLayout.run(); // apply the layout
    cy.nodes().forEach(node => {
      node.lock();
    });
    fixRootNodePosition(cy);
  }

  // Helper functions for edge highlight system

  // Highlight the given edge(s).
  // `edges` - Cytoscape element, or collection of Cytoscape elements.
  function highlightEdges(edges) {
    edges.style({
      'underlay-color': 'white',
      'underlay-padding': '5px',
      'underlay-opacity': 0.5,
      'underlay-shape': 'ellipse',
    });
  }

  // Reset the highlight of given edge(s).
  // `edges` - Cytoscape element, or collection of Cytoscape elements.
  function resetEdgesHighlight(edges) {
    edges.style({
      'underlay-color': '',
      'underlay-padding': '',
      'underlay-opacity': '',
      'underlay-shape': '',
    });
  }

  // Return a Cytoscape selector that selects edges connected to `node`.
  // `node` - Cytoscape element.
  function getConnectedEdgesSelector(node) {
    const nodeId = node.id();
    const selector = function (ele) {
      if (ele.group() !== 'edges') {
        return false;
      }
      if (ele.data('source') === nodeId || ele.data('target') === nodeId) {
        return true;
      }
      return false;
    };
    return selector;
  }

  // Highlight all edges connected to `node`.
  // `node` - Cytoscape element.
  function highlightConnectedEdges(node) {
    const edges = cy.elements(getConnectedEdgesSelector(node));
    if (edges.length > 0) {
      highlightEdges(edges);
    }
  }

  // Reset the highlight of all edges connected to `node`.
  // `node` - Cytoscape element.
  function resetConnectedEdgesHighlight(node) {
    const edges = cy.elements(getConnectedEdgesSelector(node));
    if (edges.length > 0) {
      resetEdgesHighlight(edges);
    }
  }

  // Apply the search currently in the text search field.
  const textSearchElement = document.getElementById('transparent-search');
  function performTextSearch() {
    // We will now zoom to the search results, so remove the legend highlight, if any.
    resetLegendHighlight(cy);

    // Also close the tooltip and the full info panel.
    closeTippy();
    closeTapTippy();

    const query = textSearchElement.value.trim(); // A query consisting of only whitespace doesn't count.
    const selector = highlightNodesByQuery(cy, query, 'fragments'); // 返回选择器函数；无匹配时返回 undefined

    // 缩放到匹配元素；没有匹配时缩放回全图。
    const [eles, padding] = filterElementsAndPad(cy, selector);
    cy.stop().animate({
      fit: { eles: eles, padding: padding },
      duration: 300,
    });
  }

  const debouncedPerformTextSearch = debounce(() => {
    performTextSearch();
  }, 250);

  // The text search field is a garden-variety DOM element, so attach an event listener the classical way.
  textSearchElement.addEventListener(
    'input',
    function (evt) {
      debouncedPerformTextSearch();
    },
    { signal: uiEventAbortController.signal },
  );
  textSearchElement.addEventListener(
    'focus',
    function (evt) {
      performTextSearch();
    },
    { signal: uiEventAbortController.signal },
  );

  // Attach event listeners to toolbar buttons.
  let modal = document.getElementById('timelinesModal');
  let rotateBtn = modal.getElementsByClassName('rotate')[0];
  rotateBtn.onclick = function () {
    toggleGraphOrientation(cy, layout);
    refreshLayout();
    const [eles, padding] = filterElementsAndPad(cy, undefined);
    cy.stop().animate({
      fit: { eles: eles, padding: padding },
      duration: 300,
    });
  };

  let expandBtn = modal.getElementsByClassName('expand')[0];
  expandBtn.onclick = function () {
    toggleSwipes(cy);
    refreshLayout();
  };

  let reloadBtn = modal.getElementsByClassName('reload')[0];
  reloadBtn.onclick = function () {
    slashCommandHandler(null, 'r'); // r = reload
    refreshLayout();
  };

  let zoomtofitBtn = modal.getElementsByClassName('zoomtofit')[0];
  zoomtofitBtn.onclick = function () {
    const [eles, padding] = filterElementsAndPad(cy, undefined);
    cy.stop().animate({
      fit: { eles: eles, padding: padding },
      duration: 300,
    });
  };

  let zoomtocurrentBtn = modal.getElementsByClassName('zoomtocurrent')[0];
  zoomtocurrentBtn.onclick = function () {
    zoomToCurrentChatNode(cy);
  };

  let toggleMinimapBtn = modal.getElementsByClassName('toggle-minimap')[0];
  if (toggleMinimapBtn) {
    toggleMinimapBtn.onclick = function () {
      minimapInstance?.toggle();
    };
  }

  let isMemoryFilterActive = false;
  let toggleMemoryBtn = modal.getElementsByClassName('toggle-memory-milestones')[0];
  if (toggleMemoryBtn) {
    toggleMemoryBtn.classList.remove('active');
    toggleMemoryBtn.onclick = function () {
      isMemoryFilterActive = !isMemoryFilterActive;
      toggleMemoryBtn.classList.toggle('active', isMemoryFilterActive);
      const matched = highlightMemoryMilestones(cy, isMemoryFilterActive);
      if (isMemoryFilterActive) {
        if (matched > 0) {
          toastr.info(`已高亮 ${matched} 个记忆关键节点及其因果链路。`);
        } else {
          toastr.info('当前图谱中暂无关联记忆的节点。您可在任意节点右键选择“为此节点补录记忆”。');
        }
      }
    };
  }

  // Next, attach some Cytoscape event listeners.

  cy.ready(function () {
    // Creating the legend requires scanning the graph for items to label, so do it now.
    if (extension_settings.timeline.showLegend) {
      createLegend(cy);
      document.getElementById('legendDiv').style.display = 'block';
    } else {
      document.getElementById('legendDiv').style.display = 'none';
    }
    closeOpenDrawers();
  });

  cy.on('render', function () {
    if (!hasSetOrientation) {
      hasSetOrientation = true;
      setGraphOrientationBasedOnViewport(cy, layout);
      cy.nodes().forEach(node => {
        node.lock();
      }); // nodes are always locked after running the layout anyway
      fixRootNodePosition(cy);
    }
  });

  // Hide the node full info panel and reset all highlights when tapping the graph background area
  cy.on('tap', function (evt) {
    if (evt.target === cy) {
      closeTapTippy();
      resetLegendHighlight(cy); // reset legend highlight state
      restoreElements(cy); // remove remaining highlights, if any (from text search, and edge highlighting)
    }
  });

  // Highlight edge on mouseover
  cy.on('mouseover', 'edge', function (evt) {
    const edge = evt.target;
    highlightEdges(edge);

    if (isTapTippyVisible) {
      return; // No node tooltip when the full info panel is open
    }

    // Edges can be long and sometimes only partly visible in the viewport,
    // so use manual positioning for the tooltip.
    const mousePos = {
      x: evt.originalEvent.clientX,
      y: evt.originalEvent.clientY,
    };
    let tippy = makeTippy(edge, undefined, mousePos); // 除自动说明外没有文本内容
    edge._tippy = tippy; // Store the tippy instance on the graph element (so we can hide it later)

    showTimeout = setTimeout(() => {
      tippy.show();
    }, 250); // Delay the tooltip appearance by 250 ms
  });
  cy.on('mouseout', 'edge', function (evt) {
    const edge = evt.target;
    resetEdgesHighlight(edge);

    // Clear the timeout if the mouse is moved out before the tooltip appears
    if (showTimeout) {
      clearTimeout(showTimeout);
    }

    if (edge._tippy) {
      edge._tippy.hide();
      edge._tippy = null;
    }
  });

  // Tap an edge to jump to the node at its far end
  cy.on('tap', 'edge', function (evt) {
    const clickPos = evt.renderedPosition;

    // Get positions of nodes connected by this edge
    const edge = evt.target;
    const sourceNode = cy.elements(`node[id="${edge.data('source')}"]`)[0];
    const targetNode = cy.elements(`node[id="${edge.data('target')}"]`)[0];
    const sourceNodePos = sourceNode.renderedPosition();
    const targetNodePos = targetNode.renderedPosition();

    // Compute squared distances
    const dx2_source = Math.pow(clickPos.x - sourceNodePos.x, 2);
    const dx2_target = Math.pow(clickPos.x - targetNodePos.x, 2);
    const dy2_source = Math.pow(clickPos.y - sourceNodePos.y, 2);
    const dy2_target = Math.pow(clickPos.y - targetNodePos.y, 2);
    const d2_source = dx2_source + dy2_source;
    const d2_target = dx2_target + dy2_target;

    // Center and zoom in to the node that is farther away from the click position
    let newCenterNode = d2_source > d2_target ? sourceNode : targetNode;
    cy.stop().animate({
      center: { eles: newCenterNode },
      zoom: Number(extension_settings.timeline.zoomToCurrentChatZoom),
      duration: 300, // Adjust the duration as needed for a smooth transition
    });
    flashNode(newCenterNode, 3, 250);
    newCenterNode.emit('tap');
  });

  // Tap a node to open the full info panel
  cy.on('tap', 'node', function (evt) {
    clearTimeout(showTimeout); // Clear any pending timeout for showing tooltip
    const node = evt.target;
    if (node._tippy) {
      // Hide tooltip if it is open
      node._tippy.hide();
      node._tippy = null;
    }
    const thisNodeWasOpen = node === currentlyOpenNode;

    closeTapTippy(); // 如有上一个完整信息面板，先关闭它。
    resetLegendHighlight(cy); // Reset the legend highlight state
    restoreElements(cy); // Remove remaining highlights, if any (from text search)
    highlightConnectedEdges(node); // but keep the connected edge highlights

    // If the same node was already open, close the full info panel, and restore the hover tooltip.
    if (thisNodeWasOpen) {
      const tippy = makeNodeTippy(node);
      node._tippy = tippy;
      tippy.show();
    } else {
      // Otherwise open the full info panel.
      activeTapTippy = makeTapTippy(node);
      currentlyOpenNode = node;
      activeTapTippy.show();
    }
  });

  // Double-tap a node to DWIM: find first matching message and navigate to it if possible, create a branch if absolutely necessary
  cy.on('dbltap', 'node', function (evt) {
    const node = evt.target;

    // Auto-pick first chat file that has this message
    let chat_sessions = node.data('chat_sessions');
    if (!chat_sessions) {
      // The root node has no chat sessions. It just represents the AI character(s).
      return;
    }

    chat_sessions = Object.entries(chat_sessions);
    const [file_name, session_metadata] = chat_sessions[0];
    const messageId = session_metadata.messageId;

    // If ambiguous, show which chat file was selected
    if (chat_sessions.length > 1) {
      toastr.info(`找到多个匹配项，已自动选择 "${file_name}"`);
    }

    if (node.data('isSwipe')) {
      // NOTE: This will automatically create a branch if the swipe is on a non-last message.
      //       "Avoid creating a branch *when possible*" is arguably the right behavior for the quick shortcut.
      navigateToMessage(file_name, messageId, node.data('swipeId'));
    } else {
      navigateToMessage(file_name, messageId);
    }
    closeModal();
    closeTapTippy();
    closeTippy();
    resetLegendHighlight(cy); // Reset the legend highlight state
    restoreElements(cy); // Remove remaining highlights, if any (from text search, and edge highlighting)
  });

  // Long-tap a node to reveal/hide related swipe nodes
  cy.on('taphold', 'node', function (evt) {
    const node = evt.target;
    // const nodeId = node.id();

    // Check if the node has the storedSwipes attribute
    if (node.data('storedSwipes')) {
      console.debug(node.data('storedSwipes'));
      // Determine if the swipes are already added to the graph
      const firstSwipeId = node.data('storedSwipes')[0].node.id;
      const swipeExists = cy.getElementById(firstSwipeId).length > 0;

      if (!swipeExists) {
        // For this node, add stored swipes and their edges to the graph
        node.data('storedSwipes').forEach(({ node: swipeNode, edge: swipeEdge }) => {
          // increase the edge weight
          swipeEdge.weight = 100;
          cy.add({ group: 'nodes', data: swipeNode });
          cy.add({ group: 'edges', data: swipeEdge });
        });
      } else {
        // For this node, remove stored swipes and their edges from the graph
        node.data('storedSwipes').forEach(({ node: swipeNode }) => {
          cy.getElementById(swipeNode.id).remove();
        });
      }

      refreshLayout();
    }
  });

  // Tooltip on node mouseover
  cy.on('mouseover', 'node', function (evt) {
    const node = evt.target;
    highlightConnectedEdges(node);

    if (isTapTippyVisible) {
      return; // No node tooltip when the full info panel is open
    }

    const tippy = makeNodeTippy(node);
    showTimeout = setTimeout(() => {
      tippy.show();
    }, 250); // Delay the tooltip appearance by 250 ms
  });
  cy.on('mouseout', 'node', function (evt) {
    const node = evt.target;
    resetConnectedEdgesHighlight(node);

    // Clear the timeout if the mouse is moved out before the tooltip appears
    if (showTimeout) {
      clearTimeout(showTimeout);
    }

    if (node._tippy) {
      node._tippy.hide();
      node._tippy = null;
    }
  });

  if (!hasRegisteredContextInvalidators) {
    hasRegisteredContextInvalidators = true;

    // 这些聊天事件会让缓存 key 失效，下次打开/刷新时重新取数据。
    function clearLastContext() {
      lastContextKey = null;
    }
    const context = getTimelinesContext();
    const timelineEventSource = context.eventSource ?? eventSource;
    const timelineEventTypes = context.eventTypes ?? context.event_types ?? event_types;
    [
      timelineEventTypes.CHARACTER_MESSAGE_RENDERED,
      timelineEventTypes.USER_MESSAGE_RENDERED,
      timelineEventTypes.CHAT_DELETED,
      timelineEventTypes.CHAT_CHANGED,
      timelineEventTypes.MESSAGE_SWIPED,
    ]
      .filter(Boolean)
      .forEach(eventType => timelineEventSource.on(eventType, clearLastContext));
  }
}

/**
 * Renders a Cytoscape diagram using the given node data.
 * It sets up the styles and data, initializes the Cytoscape instance,
 * and if successful, sets up event handlers for the Cytoscape instance.
 *
 * @param {Object} nodeData - The data used to render the nodes and edges of the Cytoscape diagram.
 */
function renderCytoscapeDiagram(nodeData, customLayout = null) {
  if (minimapInstance) {
    minimapInstance.destroy();
    minimapInstance = null;
  }
  if (theCy) {
    theCy.destroy();
    theCy = null;
  }
  uiEventAbortController?.abort();
  uiEventAbortController = new AbortController();

  const styles = setupStylesAndData(nodeData);
  const activeLayout = customLayout || layout;
  const cy = initializeCytoscape(nodeData, styles, activeLayout);
  if (cy) {
    if (extension_settings.timeline.enableMinZoom) {
      cy.minZoom(Number(extension_settings.timeline.minZoom));
    }
    if (extension_settings.timeline.enableMaxZoom) {
      cy.maxZoom(Number(extension_settings.timeline.maxZoom));
    }
    setupEventHandlers(cy, nodeData);
    initContextMenu(cy, {
      onReload: async forceReload => {
        await onTimelineButtonClick(forceReload);
      },
    });

    const networkContainer = document.getElementById('networkContainer');
    minimapInstance = new Minimap(cy, networkContainer);

    // 1. 同步时间树拓扑状态供外部 API 导出读取
    const currentContext = getTimelinesContext();
    setTimelineGraphState(nodeData, currentContext?.chatId || currentContext?.chatMetadata?.file_name);

    // 2. 主动异步查询 Luker memory-graph 记忆索引并渲染徽章与光环
    (async () => {
      try {
        const memoryIndex = await buildMemoryIndexForGraph(currentContext, nodeData);
        if (memoryIndex && memoryIndex.size > 0 && theCy) {
          theCy.batch(() => {
            for (const [nodeId, meta] of memoryIndex.entries()) {
              const cyNode = theCy.getElementById(nodeId);
              if (cyNode && cyNode.length > 0) {
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
            }
          });
        }
      } catch (err) {
        console.warn('Timelines: 异步加载记忆节点索引失败:', err);
      }
    })();
  }
}

/**
 * Checks if the timeline data needs to be updated based on the context.
 * If the current context (representing either a character or a group chat session)
 * is different from the last known context, it fetches and prepares the required data.
 * The function then updates the layout configuration based on extension settings.
 *
 * @param {boolean} [forceReload=false] - 是否强制清空缓存并全量拉取数据。
 * @returns {Promise<boolean>} Returns true if the timeline data was updated, and false otherwise.
 */
async function updateTimelineDataIfNeeded(forceReload = false) {
  const context = getTimelinesContext();
  const contextKey = makeContextKey(context);
  if (forceReload || lastContextKey !== contextKey) {
    let data = {};

    if (!context.characterId) {
      // group chat
      let groupID = context.groupId;
      if (groupID) {
        let group = context.groups.find(group => group.id === groupID);
        if (!group?.chats?.length) {
          lastTimelineData = [];
          lastContextKey = contextKey;
          return true;
        }
        for (let i = 0; i < group.chats.length; i++) {
          data[i] = { file_name: group.chats[i] };
        }
        lastTimelineData = await prepareData(data, true, forceReload);
      } else {
        lastTimelineData = [];
      }
    } else {
      data = await fetchData(context.characters[context.characterId].avatar);
      lastTimelineData = await prepareData(data, false, forceReload);
    }

    lastContextKey = contextKey;
    console.info('Timelines: 时间线数据已更新。');

    // https://github.com/cytoscape/cytoscape.js-dagre
    // https://js.cytoscape.org/#layouts
    layout = {
      name: 'dagre',
      nodeDimensionsIncludeLabels: true,
      nodeSep: extension_settings.timeline.nodeSeparation, // 同一层级中相邻节点之间的间距。
      edgeSep: extension_settings.timeline.edgeSeparation, // 同一层级中相邻边之间的间距。
      rankSep: extension_settings.timeline.rankSeparation, // 布局中各层级之间的间距。
      rankDir: 'LR', // 'TB' 为从上到下，'LR' 为从左到右；可由 `toggleGraphOrientation` 切换。
      ranker: extension_settings.timeline.nodeRanker, // 节点层级算法：'network-simplex'、'tight-tree' 或 'longest-path'。
      spacingFactor: extension_settings.timeline.spacingFactor, // 扩展或压缩节点整体占用区域的乘数（> 0）。
      acyclicer: 'greedy', // 使用贪心方式兜底避免环。
      align: extension_settings.timeline.align, // 层级节点对齐方式；可为 'UL'、'UR'、'DL' 或 'DR'。
      sort: function (a, b) {
        return a.id().localeCompare(b.id());
      }, // 布局并列时使用稳定 ID 排序。
    };
    return true; // 数据已更新。
  }
  return false; // No update occurred
}

/**
 * Centers and zooms to the chat node containing the current chat message.
 *
 * @param {Object} cy - The Cytoscape instance.
 */
function zoomToCurrentChatNode(cy) {
  if (!cy) {
    console.error('Timelines: 没有 Cytoscape 实例，无法缩放到当前聊天节点。');
    return;
  }

  // 获取当前聊天的最后一条消息。
  const context = getTimelinesContext();
  const chat = Array.isArray(context.chat) ? context.chat : [];
  if (chat.length === 0) {
    console.info('Timelines: 当前聊天为空，跳过当前节点定位。');
    return;
  }
  const lastMessageId = chat.length - 1;
  const lastMessageObj = chat[lastMessageId];
  if (!lastMessageObj?.mes) {
    console.info('Timelines: 当前聊天最后一条消息没有文本，跳过当前节点定位。');
    return;
  }
  const mes = lastMessageObj.mes;

  // 在图上查找包含该消息文本的节点。
  const selector = function (ele) {
    return ele.data('msg') === mes;
  };
  const newCenterNode = cy.filter(selector);
  if (newCenterNode.length === 0) {
    console.info('Timelines: 图中没有找到当前聊天节点。');
    return;
  }
  resetLegendHighlight(cy);

  // Center and zoom in
  cy.stop().animate({
    center: { eles: newCenterNode },
    zoom: Number(extension_settings.timeline.zoomToCurrentChatZoom),
    duration: 300, // Adjust the duration as needed for a smooth transition
  });

  flashNode(newCenterNode, 4, 500);
}

/**
 * Draw the user's attention to a node by flashing it on and off a few times.
 *
 * @param {Object} node - A Cytoscape node.
 * @param {number} howManyFlashes - As it says on the tin.
 * @param {number} duration - Half-period length in ms.
 */
function flashNode(node, howManyFlashes, duration) {
  node.flashClass('NoticeMe', duration); // do the first flash now
  for (let j = 1; j < howManyFlashes; j++) {
    // schedule the rest
    setTimeout(
      () => {
        node.flashClass('NoticeMe', duration);
      },
      2 * j * duration,
    );
  }
}

/**
 * Handler function that is called when the timeline button is clicked.
 * This function checks if the timeline data needs to be updated, handles modal display,
 * potentially renders the Cytoscape diagram, and sets the focus on a specific HTML element.
 *
 * @returns {Promise<void>}
 */
async function onTimelineButtonClick(forceReload = false) {
  let dataUpdated = false;
  try {
    showLoader();
    await vendorReady;
    if (vendorLoadError) {
      toastr.error('Timelines: 第三方依赖加载失败，无法打开时间线。');
      return;
    }
    dataUpdated = await updateTimelineDataIfNeeded(forceReload);
  } finally {
    await delay(1); // This avoids the loading screen getting stuck when there is no need to update the data.
    hideLoader();
  }

  handleModalDisplay(); // Show the timeline view, and wire the close button to close it.
  if (dataUpdated || !theCy) {
    let activeLayout = layout;
    if (Array.isArray(lastTimelineData) && lastTimelineData.length > 0) {
      try {
        const layoutRes = await layoutService.computeLayout(lastTimelineData, {
          ...layout,
          nodeWidth: extension_settings.timeline.nodeWidth,
          nodeHeight: extension_settings.timeline.nodeHeight,
        });
        if (layoutRes.success && layoutRes.positions) {
          activeLayout = {
            name: 'preset',
            positions: node => layoutRes.positions[node.id()] || { x: 0, y: 0 },
            fit: true,
            padding: 50,
          };
        }
      } catch (err) {
        console.warn('Timelines: 异步布局计算异常，采用主线程布局：', err);
      }
    }
    renderCytoscapeDiagram(lastTimelineData, activeLayout); // after this, the Cytoscape instance `theCy` is alive
    toggleSwipes(theCy, extension_settings.timeline.autoExpandSwipes);
  }
  closeOpenDrawers();

  // Let the window layout settle itself for 500 ms before trying to zoom
  // (this avoids some failed pans/zooms).
  setTimeout(() => {
    let textSearchElement = document.getElementById('transparent-search');
    if (textSearchElement) {
      textSearchElement.focus();
      textSearchElement.select(); // select content for easy erasing
    }
    if (theCy) {
      zoomToCurrentChatNode(theCy); // override the zoom-to-search
    }
    // textSearchElement.dispatchEvent(new Event('input'));  // no need to trigger input event to perform search, since now focusing the element already searches
  }, 500);
}

/**
 * Handler function that is called when the slash command is used.
 * This function checks if the timeline data needs to be updated, and potentially renders the Cytoscape diagram.
 * It also handles the `r` argument, which reloads the graph.
 *
 * @param {Object} _ - The slash event object.
 * @param {string} reload - The argument passed to the slash command.
 * @returns {Promise<void>}
 */
function slashCommandHandler(_, reload) {
  const force = reload === 'r';
  if (force) {
    lastContextKey = null;
  }
  onTimelineButtonClick(force);
}

/**
 * Entry point function for the jQuery script.
 * It handles adding UI components to the extension settings, binds events to various UI components,
 * and sets up event handlers for user interactions.
 */
jQuery(async () => {
  const settingsHtml = await $.get(`${extensionFolderPath}settings.html`);
  $('#timelines_container').remove();
  $('#extensions_settings').append(settingsHtml);
  $('#show_timeline_view').on('click', onTimelineButtonClick);
  registerSlashCommand('tl', slashCommandHandler, [], '/tl 显示时间线；"/tl r" 重新加载图', false, true);

  // Bind listeners to the specific inputs; format: {html_ui_id: name_in_default_settings, ...}
  const idsToSettingsMap = {
    tl_node_width: 'nodeWidth',
    tl_node_height: 'nodeHeight',
    tl_node_separation: 'nodeSeparation',
    tl_edge_separation: 'edgeSeparation',
    tl_rank_separation: 'rankSeparation',
    tl_spacing_factor: 'spacingFactor',
    tl_tooltip_fixed: 'fixedTooltip',
    tl_hover_tooltip_fixed: 'fixedHoverTooltip',
    tl_gpu_acceleration: 'gpuAcceleration',
    tl_align: 'align',
    tl_node_ranker: 'nodeRanker',
    tl_node_shape: 'nodeShape',
    tl_curve_style: 'curveStyle',
    tl_swipe_scale: 'swipeScale',
    tl_avatar_as_root: 'avatarAsRoot',
    tl_show_legend: 'showLegend',
    tl_use_chat_colors: 'useChatColors',
    tl_auto_expand_swipes: 'autoExpandSwipes',
    tl_zoom_current_chat: 'zoomToCurrentChatZoom',
    tl_zoom_min_cb: 'enableMinZoom',
    tl_zoom_min: 'minZoom',
    tl_zoom_max_cb: 'enableMaxZoom',
    tl_zoom_max: 'maxZoom',
    'bookmark-color-picker': 'bookmarkColor',
    'edge-color-picker': 'edgeColor',
    'user-node-color-picker': 'userNodeColor',
    'char-node-color-picker': 'charNodeColor',
  };

  for (let [id, settingName] of Object.entries(idsToSettingsMap)) {
    if (id.includes('color-picker')) {
      // or a more specific way to identify color pickers if needed
      $(`#${id}`).on('change', function (evt) {
        onInputChange($(this), settingName, evt.detail.rgba);
      });
    } else {
      $(`#${id}`).on('input', function () {
        onInputChange($(this), settingName);
      });
    }
  }

  async function updateCacheStatusUI() {
    try {
      const usage = await timelinesCache.getStorageUsage();
      const kb = (usage.estimatedBytes / 1024).toFixed(1);
      $('#timelinesCacheStatus').text(`已缓存 ${usage.chatCount} 个聊天记录，估算占用空间 ${kb} KB`);
    } catch (e) {
      $('#timelinesCacheStatus').text('无法读取缓存信息');
    }
  }

  $(document).ready(function () {
    $('#toggleStyleSettings').click(function () {
      $('#styleSettingsArea').toggleClass('hidden');
    });
    $('#toggleColorSettings').click(function () {
      $('#colorSettingsArea').toggleClass('hidden');
    });
    $('#toggleCacheSettings').click(function () {
      $('#cacheSettingsArea').toggleClass('hidden');
      if (!$('#cacheSettingsArea').hasClass('hidden')) {
        updateCacheStatusUI();
      }
    });
  });

  $('#refreshCurrentCacheBtn').on('click', async function () {
    const context = getTimelinesContext();
    const scopeKey = !context.characterId
      ? `group_${context.groupId || 'unknown'}`
      : `char_${context.characterId ?? 'unknown'}`;
    await timelinesCache.clearScope(scopeKey);
    lastContextKey = null;
    await updateCacheStatusUI();
    toastr.info('当前角色本地缓存已清空，下次打开将重新获取。');
  });

  $('#clearAllCacheBtn').on('click', async function () {
    await timelinesCache.clearAll();
    lastContextKey = null;
    await updateCacheStatusUI();
    toastr.info('所有角色的时间线本地缓存已清空。');
  });

  $('#resetSettingsBtn').click(function () {
    extension_settings[settingsNamespace] = Object.assign({}, defaultSettings);
    extension_settings[legacySettingsNamespace] = extension_settings[settingsNamespace];
    loadSettings();
    saveSettingsDebounced();
  });

  $(document).on('keydown', function (event) {
    processTimelinesHotkeys(event.originalEvent);
  });

  loadSettings();
  registerTimelinesExtensionApi();
});

/**
 * Event handler function that is called when an input element's value is changed.
 * 根据输入元素及其类型更新 Timelines 设置对象。
 *
 * @param {Object} element - The jQuery object representing the changed input element.
 * @param {string} settingName - The setting name corresponding to the changed input.
 * @param {Object|null} rgbaValue - The rgba value for color picker inputs (optional).
 */
function onInputChange(element, settingName, rgbaValue = null) {
  // Get new value from the GUI element
  let value;
  if (element.is(':checkbox')) {
    value = element.prop('checked');
  } else if (element.is('toolcool-color-picker')) {
    value = rgbaValue;
  } else {
    value = element.val();
  }

  const elementId = element.attr('id');

  // Enforce consistency between the various zoom settings
  let otherSetting = undefined; // 用于触发另一个关联设置的变更
  if (elementId.includes('_zoom_')) {
    // enable/disable min/max sliders based on checkbox state
    if (elementId === 'tl_zoom_min_cb') {
      const enabled = Boolean(value);
      $('#tl_zoom_min').prop('disabled', !enabled);
      // `.addClass('disabled')` / `.removeClass('disabled')` doesn't change the visual appearance of a slider, so we don't bother.

      // When the min is suddenly enabled, change the min to the zoomToCurrentChatZoom, if it is currently larger.
      // This is better than changing zoomToCurrentChatZoom, because that was already enabled, but the min wasn't.
      if (
        enabled &&
        Number(extension_settings.timeline.minZoom) > Number(extension_settings.timeline.zoomToCurrentChatZoom)
      ) {
        otherSetting = $('#tl_zoom_min');
        otherSetting.val(extension_settings.timeline.zoomToCurrentChatZoom); // 夹紧另一个设置值
      }
    }
    if (elementId === 'tl_zoom_max_cb') {
      const enabled = Boolean(value);
      $('#tl_zoom_max').prop('disabled', !enabled);

      if (
        enabled &&
        Number(extension_settings.timeline.maxZoom) < Number(extension_settings.timeline.zoomToCurrentChatZoom)
      ) {
        otherSetting = $('#tl_zoom_max');
        otherSetting.val(extension_settings.timeline.zoomToCurrentChatZoom); // 夹紧另一个设置值
      }
    }

    if (elementId === 'tl_zoom_current_chat') {
      // clamp to [min, max] when min/max enabled
      if (extension_settings.timeline.enableMinZoom && Number(value) < Number(extension_settings.timeline.minZoom)) {
        value = extension_settings.timeline.minZoom;
        $('#tl_zoom_current_chat').val(value); // send clamped value back to GUI
      }
      if (extension_settings.timeline.enableMaxZoom && Number(value) > Number(extension_settings.timeline.maxZoom)) {
        value = extension_settings.timeline.maxZoom;
        $('#tl_zoom_current_chat').val(value); // send clamped value back to GUI
      }
    }

    if (elementId === 'tl_zoom_min') {
      // clamp to max; change zoomToCurrentChatZoom if changing min would make it smaller than new min
      if (extension_settings.timeline.enableMaxZoom && Number(value) > Number(extension_settings.timeline.maxZoom)) {
        value = extension_settings.timeline.maxZoom;
        $('#tl_zoom_min').val(value); // send clamped value back to GUI
      }
      if (Number(value) > Number(extension_settings.timeline.zoomToCurrentChatZoom)) {
        otherSetting = $('#tl_zoom_current_chat');
        otherSetting.val(value); // 夹紧另一个设置值
      }
    }
    if (elementId === 'tl_zoom_max') {
      // clamp to min; change zoomToCurrentChatZoom if changing max would make it larger than new max
      if (extension_settings.timeline.enableMinZoom && Number(value) < Number(extension_settings.timeline.minZoom)) {
        value = extension_settings.timeline.minZoom;
        $('#tl_zoom_max').val(value); // send clamped value back to GUI
      }
      if (Number(value) < Number(extension_settings.timeline.zoomToCurrentChatZoom)) {
        otherSetting = $('#tl_zoom_current_chat');
        otherSetting.val(value); // 夹紧另一个设置值
      }
    }
  }

  // Only update the `..._value` label in the GUI if the value is numeric
  if (!isNaN(value)) {
    const isFloat = element.hasClass('floatingpoint');
    let displayValue = value;
    if (!isFloat) {
      // round to integer unless tagged as a float
      displayValue = Math.round(value);
    }
    $(`#${elementId}_value`).text(displayValue);
  }

  if (isLoadingSettings) {
    return;
  }

  // Update the actual setting
  extension_settings.timeline[settingName] = value;
  lastContextKey = null; // 让下一次打开时间线时重新取数据

  // If changing this setting triggered a linked update on another setting, process it now.
  // We must do this *after* updating the actual settings object, so that one debounced save
  // saves the new value of both settings.
  if (otherSetting) {
    otherSetting.trigger('input');
  }

  saveSettingsDebounced();
}

/**
 * Processes hotkeys for the Timelines extension.
 *
 * @param {KeyboardEvent} event - The keyboard event.
 */
function processTimelinesHotkeys(event) {
  // Only handle hotkeys when the timeline view is open
  if (!$('#timelinesModal').is(':visible')) {
    return;
  }

  // TODO: There's already a keydown handler on the document, from `RossAscends-mods.js`.
  // The issue is that it has already triggered when we get here - so things like pressing
  // arrow keys will cause swipes, although the main GUI is covered by the Timelines modal.
  // This isn't a problem when the search field is focused; it understands arrow keys correctly.
  // It's just that when the focus is elsewhere, arrow keys fall through.
  // The alternative solution of attaching our handler to the modal (instead of to the document)
  // fails to register keypresses.
  //
  // What this does is prevent the event from falling through any further while the modal is open.
  event.stopPropagation();

  // console.log(event);  // debug/development

  if (event.ctrlKey && event.shiftKey && event.key === 'F') {
    // A bare "Ctrl+F" would also trigger the browser's search field
    const textSearchElement = document.getElementById('transparent-search');
    textSearchElement.focus();
    textSearchElement.select(); // select content for easy erasing
  }

  if (event.key === 'Escape') {
    closeModal();
    closeTapTippy();
    closeTippy();
    if (theCy) {
      resetLegendHighlight(theCy); // Reset the legend highlight state
      restoreElements(theCy); // Remove remaining highlights, if any (from text search, and edge highlighting)
    }
  }
}
