import { normalizeMessageText } from './helpers.js';

/**
 * Preprocesses chat sessions to aggregate messages from different files into a unified structure.
 * For each message position/index across all chat files, it creates an array of messages at that position
 * from every chat file, effectively transposing the structure.
 *
 * @param {Object} channelHistory - An object where keys are file names and values are arrays of chat messages.
 * @returns {Array} allChats - A 2D array where each sub-array corresponds to a message index.
 */
export function preprocessChatSessions(channelHistory) {
  let allChats = [];

  for (const [file_name, messages] of Object.entries(channelHistory || {})) {
    if (!Array.isArray(messages)) continue;
    messages.forEach((message, index) => {
      if (!allChats[index]) {
        allChats[index] = [];
      }
      allChats[index].push({
        file_name,
        index,
        message,
      });
    });
  }

  return allChats;
}

/**
 * Groups messages by their content to create a collection of unique messages.
 *
 * @param {Array} messages - A list of message objects, each containing file_name and message details.
 * @returns {Object} groups - An object where the key is the normalized message content and the value is
 *                            an array of message objects that share that content.
 */
export function groupMessagesByContent(messages) {
  let groups = {};
  if (!Array.isArray(messages)) return groups;

  messages.forEach((messageObj, index) => {
    let { file_name, message } = messageObj;
    const normalizedMessageText = normalizeMessageText(message);
    try {
      if (!groups[normalizedMessageText]) {
        groups[normalizedMessageText] = [];
      }
      groups[normalizedMessageText].push({ file_name, index, message });
    } catch (e) {
      console.error(`Timelines: 消息分组失败：${e}`);
    }
  });
  return groups;
}

/**
 * Constructs nodes and associated edges for each message index based on processed chat sessions.
 * Strictly deduplicates nodes and edges so each unique node and edge is added exactly once.
 *
 * @param {Array} allChats - A 2D array resulting from `preprocessChatSessions`.
 * @param {Object} allChatFileNamesAndLengths - A dictionary `{file_name: length_in_messages}`.
 * @returns {Array} cyElements - A list of deduplicated node and edge objects suitable for Cytoscape.
 */
export function buildGraph(allChats, allChatFileNamesAndLengths = {}) {
  let cyElements = [];
  let keyCounter = 1;
  let previousNodes = {};
  let parentSwipeData = {};
  const createdEdges = new Set();

  if (!Array.isArray(allChats) || allChats.length === 0 || !allChats[0]) {
    return cyElements;
  }

  // Gather name(s) of AI characters from chat history, for root node
  let characterNames = new Set();
  for (let messageId = 0; messageId < allChats.length; messageId++) {
    const messages = allChats[messageId] || [];
    messages.forEach(messageObj => {
      const { message } = messageObj;
      if (message && !message.is_user && !message.is_system && message.name) {
        characterNames.add(message.name);
      }
    });
  }
  const rootNodeName = [...characterNames].sort().join(', ');

  // Initialize root node
  cyElements.push({
    group: 'nodes',
    data: {
      id: 'root',
      label: 'root',
      name: rootNodeName,
      send_date: '',
      x: 0,
      y: 0,
    },
  });

  // Initialize previousNodes (anchoring the beginning of each chat to the graph root node)
  allChats[0].forEach(({ file_name }) => {
    previousNodes[file_name] = 'root';
  });

  for (let messageId = 0; messageId < allChats.length; messageId++) {
    let groups = groupMessagesByContent(allChats[messageId]);

    for (const [text, group] of Object.entries(groups)) {
      const nodeId = `message${keyCounter}`;
      keyCounter += 1;
      const node = createNode(nodeId, messageId, text, group, allChatFileNamesAndLengths);

      // 1. 推入唯一节点（修复原本在 group 遍历中重复推入的缺陷）
      cyElements.push({
        group: 'nodes',
        data: node,
      });

      // 提取唯一 swipes
      const allSwipes = [];
      let uniqueSwipes = [];
      if (messageId !== 0) {
        group.forEach(messageObj => {
          const swipes = messageObj.message?.swipes || [];
          allSwipes.push(...swipes);
        });
        uniqueSwipes = [...new Set(allSwipes)].filter(swipeText => swipeText !== text);
      }

      const uniqueParents = new Set();
      for (const messageObj of group) {
        const parentNodeId = previousNodes[messageObj.file_name] ?? 'root';

        // 处理 swipes 关联
        if (messageId !== 0 && !uniqueParents.has(parentNodeId)) {
          uniqueParents.add(parentNodeId);

          if (!parentSwipeData[parentNodeId]) {
            parentSwipeData[parentNodeId] = {
              storedSwipes: [],
              totalSwipes: 0,
              currentSwipeIndex: uniqueSwipes.indexOf(text),
            };
          }

          parentSwipeData[parentNodeId].totalSwipes += uniqueSwipes.length;

          uniqueSwipes.forEach(swipeText => {
            const swipeNodeId = `swipe${keyCounter}-${parentSwipeData[parentNodeId].totalSwipes}`;
            const swipeIndex = allSwipes.indexOf(swipeText);
            const swipeNode = {
              ...node,
              id: swipeNodeId,
              msg: swipeText,
              isSwipe: true,
              swipeId: swipeIndex,
            };
            delete swipeNode.swipes;

            const swipeEdge = {
              id: `edgeSwipe${keyCounter}`,
              source: parentNodeId,
              target: swipeNodeId,
              isSwipe: true,
              swipeId: swipeIndex,
            };

            parentSwipeData[parentNodeId].storedSwipes.push({ node: swipeNode, edge: swipeEdge });
            keyCounter += 1;
          });
        }

        // 2. 推入唯一边（相同 parentNodeId -> nodeId 只生成一条边）
        const edgeKey = `${parentNodeId}->${nodeId}`;
        if (!createdEdges.has(edgeKey)) {
          createdEdges.add(edgeKey);
          cyElements.push({
            group: 'edges',
            data: {
              id: `edge${keyCounter}`,
              source: parentNodeId,
              target: nodeId,
            },
          });
          keyCounter += 1;
        }

        // 更新该分支的最新游标节点
        previousNodes[messageObj.file_name] = nodeId;
      }
    }
  }

  // 更新各父节点中的 swipe 统计元数据
  cyElements.forEach(element => {
    if (element.group === 'nodes' && parentSwipeData[element.data.id]) {
      Object.assign(element.data, parentSwipeData[element.data.id]);
    }
  });

  return cyElements;
}

/**
 * Constructs a Cytoscape node object based on provided message details.
 */
export function createNode(nodeId, messageId, text, group, allChatFileNamesAndLengths = {}) {
  let bookmark = group.find(({ message }) => {
    if (!message) return false;
    if (
      message.is_system &&
      typeof message.mes === 'string' &&
      message.mes.includes('Bookmark created! Click here to open the bookmark chat')
    )
      return true;
    return !!message.extra && !!message.extra.bookmark_link;
  });

  let isBookmark = Boolean(bookmark);
  let bookmarkName, fileNameForNode;
  if (isBookmark) {
    if (bookmark.message?.extra?.bookmark_link) {
      bookmarkName = bookmark.message.extra.bookmark_link;
      fileNameForNode = bookmark.file_name;
    } else {
      let match = bookmark.message?.mes?.match(/file_name=\"(.*?)\"/);
      bookmarkName = match ? match[1] : null;
      fileNameForNode = bookmarkName;
    }
  } else {
    fileNameForNode = group[0]?.file_name;
  }

  // 检查点死链忽略
  if (
    isBookmark &&
    bookmarkName &&
    !allChatFileNamesAndLengths.hasOwnProperty(`${bookmarkName}.jsonl`) &&
    !allChatFileNamesAndLengths.hasOwnProperty(bookmarkName)
  ) {
    isBookmark = false;
    bookmarkName = null;
  }

  let is_name = group[0]?.message?.name ?? null;
  let is_user = group[0]?.message?.is_user ?? false;
  let is_system = group[0]?.message?.is_system ?? false;
  let name = group[0]?.message?.name ?? null;
  let send_date = group[0]?.message?.send_date ?? null;

  let chat_sessions = {};
  for (const { file_name, index } of group) {
    chat_sessions[file_name] = {
      messageId: messageId,
      indexInGroup: index,
      length: allChatFileNamesAndLengths[file_name] ?? 0,
    };
  }

  return {
    id: nodeId,
    msg: text,
    chat_depth: messageId,
    isBookmark: isBookmark,
    bookmarkName: bookmarkName,
    file_name: fileNameForNode,
    is_name: is_name,
    is_user: is_user,
    is_system: is_system,
    name: name,
    send_date: send_date,
    color: isBookmark ? generateUniqueColor(text) : null,
    chat_sessions: chat_sessions,
  };
}

/**
 * Seedable PRNG sfc32
 */
export function sfc32(a, b, c, d) {
  return function () {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    var t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Generates a unique, stable pseudo-random RGBA color for a given text.
 */
export function generateUniqueColor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  const rand = sfc32(hash, 0x9e3779b9, 0x243f6a88, 0xb7e15162);
  const r = Math.floor(rand() * 256);
  const g = Math.floor(rand() * 256);
  const b = Math.floor(rand() * 256);
  return `rgba(${r}, ${g}, ${b}, 1)`;
}

/**
 * 高性能 O(1) 路径高亮寻路：
 * 利用预先构建的 nodeMap 和 incomingEdgeMap 哈希表，消灭全量循环线性扫描。
 *
 * @param {Map<string, Object>} nodeMap - id -> 节点元素映射
 * @param {Map<string, Object>} incomingEdgeMap - targetId -> 入边元素映射
 * @param {Object} bookmarkNode - 检查点起始节点
 * @param {number} currentHighlightThickness - 起始高亮粗细
 * @param {number} startingZIndex - 起始 z-index
 */
export function highlightPathToRoot(
  nodeMap,
  incomingEdgeMap,
  bookmarkNode,
  currentHighlightThickness = 4,
  startingZIndex = 1000,
) {
  if (!bookmarkNode) return;

  let currentNode = bookmarkNode;
  let currentZIndex = startingZIndex;

  while (currentNode) {
    if (currentNode !== bookmarkNode && currentNode.data.isBookmark) {
      break;
    }

    const incomingEdge = incomingEdgeMap.get(currentNode.data.id);
    if (incomingEdge) {
      incomingEdge.data.isHighlight = true;
      incomingEdge.data.color = bookmarkNode.data.color;
      incomingEdge.data.bookmarkName = bookmarkNode.data.bookmarkName;
      incomingEdge.data.highlightThickness = currentHighlightThickness;
      currentHighlightThickness = Math.min(currentHighlightThickness + 0.1, 6);

      currentNode.data.borderColor = incomingEdge.data.color;
      incomingEdge.data.zIndex = currentZIndex;
      currentZIndex += 1;

      currentNode = nodeMap.get(incomingEdge.data.source) || null;
    } else {
      currentNode = null;
    }
  }
}

/**
 * 将合并后的所有聊天记录转为 Cytoscape 拓扑图节点与边数组
 * @param {Object} chatHistory - { [fileName]: messagesArray }
 * @returns {Array} Cytoscape 节点与边元素数组
 */
export function convertToCytoscapeElements(chatHistory) {
  const allChats = preprocessChatSessions(chatHistory);
  const allChatFileNamesAndLengths = {};
  for (const [key, val] of Object.entries(chatHistory || {})) {
    allChatFileNamesAndLengths[key] = Array.isArray(val) ? val.length : 0;
  }
  return buildGraph(allChats, allChatFileNamesAndLengths);
}
