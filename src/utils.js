import { openCharacterChat, addOneMessage, event_types, eventSource } from '../../../../../script.js';
import { power_user } from '../../../../power-user.js';
import { createBranch } from '../../../../bookmarks.js';
import { getTokenCount } from '../../../../tokenizers.js';
import { getContext } from '../../../../extensions.js';
import { debounce } from '../../../../utils.js';
import { cloneSwipeExtra } from './helpers.js';

function getTimelinesContext() {
    return window.Luker?.getContext?.() ?? getContext();
}

const saveChatDebounced = debounce(() => getTimelinesContext().saveChat(), 2000);

/**
 * Navigates to a specific chat message in a chat session by adjusting the scroll position.
 * If the message is not initially visible, the function attempts to reveal it either by
 * showing hidden messages or by triggering a button to load more messages.
 * Optionally, the function can create a new branch based on the message or navigate to
 * a specific swipe associated with the message.
 *
 * @param {string} chatSessionName - Name of the chat session file (can include .jsonl extension).
 * @param {number} messageId - ID of the message to navigate to, in the sequential message numbering of the chat session.
 *                             This is the Cytoscape node's graph depth minus one (because both are 0-based, and the graph
 *                             has a root node, which doesn't correspond to any message).
 * @param {number} [swipeId=-1] - Optional ID of a swipe associated with the message. If provided and >= 0,
 *                                the function navigates to the swipe after potentially creating a new branch.
 *                                swipeId is 0-based, but the log displays it in a 1-based format, to match the GUI.
 * @param {boolean} [branch=false] - If true, creates a new branch based on the message and navigates to it.
 *                                   If false, avoids creating a branch when possible.
 *                                   A new branch is always created when navigating to a swipe on a non-last message.
 * @returns {Promise<void>} Resolves once the navigation is complete.
 *
 * Behavior:
 * 1. Opens the specified chat session.
 * 2. Attempts to find and scroll to the message with the given ID.
 * 3. If the message is not visible, reveals hidden messages or triggers loading of more messages.
 * 4. If the `branch` parameter is true, creates a new branch based on the message and navigates to it.
 * 5. If `swipeId` is provided and >= 0, navigates to the associated swipe after potentially creating a new branch.
 */
export async function navigateToMessage(chatSessionName, messageId, swipeId = -1, branch = false) {

    // Sanity check (a message might have a null `swipeId`)
    if (swipeId === null || swipeId === undefined) {
        swipeId = -1;
    }

    // Remove extension from file name
    chatSessionName = chatSessionName.replace('.jsonl', '');

    // Switch to the requested chat session
    await openCharacterChat(chatSessionName);  // TODO: 群聊可能需要额外处理。
    const chat = $('#chat');
    const sessionLength = chat.children('.mes').length;

    // Attempt to describe in the log what we were requested to do.
    if (branch) {
        if (swipeId >= 0) {
            console.info(`Timelines: 用户请求在 ${chatSessionName} 的第 ${messageId} 条消息的第 ${swipeId + 1} 个 swipe 处创建新分支（当前 ${sessionLength} 条消息）。`);
        } else {
            console.info(`Timelines: 用户请求在 ${chatSessionName} 的第 ${messageId} 条消息处创建新分支（当前 ${sessionLength} 条消息）。`);
        }
    } else {
        if (swipeId >= 0) {
            console.info(`Timelines: 用户请求跳转到 ${chatSessionName} 的第 ${messageId} 条消息的第 ${swipeId + 1} 个 swipe（当前 ${sessionLength} 条消息）。`);
        } else {
            console.info(`Timelines: 用户请求跳转到 ${chatSessionName} 的第 ${messageId} 条消息（当前 ${sessionLength} 条消息）。`);
        }
    }

    try {
        // Find the message div matching `messageId`, making it visible if hidden.
        let message = $(`div[mesid=${messageId}]`);
        while (!message.is(':visible')) {
            console.info(`Timelines: 第 ${messageId} 条消息当前不可见，正在查找。`);
            if (chat.children('.mes').not(':visible').length > 0) {  // maybe hidden?
                console.info('Timelines: 正在显示隐藏消息。');
                const prevHeight = chat.prop('scrollHeight');
                chat.children('.mes').not(':visible').slice(-power_user.lazy_load).show();
                const newHeight = chat.prop('scrollHeight');
                chat.scrollTop(newHeight - prevHeight);
            } else {  // maybe need to show more messages?
                const showMoreBtn = $('#show_more_messages');
                if (showMoreBtn.length) {
                    console.info('Timelines: 正在显示更多消息。');
                    showMoreBtn.trigger('mouseup');
                } else {  // no more hiding places
                    console.info(`Timelines: 未找到 ${chatSessionName} 中的第 ${messageId} 条消息，无法跳转。`);
                    return;
                }
            }
            message = $(`div[mesid=${messageId}]`);  // search again
        }

        if (branch) {  // Create and open a new branch at target message (and open its target swipe, if any)
            console.info(`Timelines: 用户请求在 ${chatSessionName} 的第 ${messageId} 条消息处创建新聊天分支。`)
            const name = await createBranch(messageId);
            await openCharacterChat(name);
            console.info(`Timelines: 已创建聊天分支 ${name}。`)
            if (swipeId >= 0) {  // Navigate to the requested swipe, if any.
                console.info(`Timelines: 正在显示 ${name} 中第 ${messageId} 条消息的第 ${swipeId + 1} 个 swipe。`)
                goToSwipe(swipeId);  // always applies to the last message in the chat
            }
        }
        else if (swipeId >= 0) {  // Navigate to a swipe, trying to avoid creating a branch
            // - If the target is the last message in the chat, we can just navigate to the requested swipe.
            // - But if not, the request cannot be satisfied, because the stored swipes are hidden by the
            //   later messages. In this case we create a new branch.
            let name = chatSessionName;
            const canNavigateToSwipe = (messageId === (sessionLength - 1));
            if (canNavigateToSwipe) {
                console.info(`Timelines: 第 ${messageId} 条消息是 ${chatSessionName} 的最后一条消息，可直接使用 swipes。`)
            } else {
                console.info(`Timelines: 正在创建新聊天分支，以显示 ${chatSessionName} 中非末尾消息 ${messageId} 保存的 swipes。`)
                name = await createBranch(messageId);
                await openCharacterChat(name);
                console.info(`Timelines: 已创建聊天分支 ${name}。`)
            }
            console.info(`Timelines: 正在显示 ${name} 中第 ${messageId} 条消息的第 ${swipeId + 1} 个 swipe。`)
            goToSwipe(swipeId);  // always applies to the last message in the chat
        }
        else {  // Easy case: no branching, no swipes - just navigate to the target message by scrolling the chat.
            if (message.length) {  // found the div?
                console.info(`Timelines: 正在滚动到 ${chatSessionName} 中的第 ${messageId} 条消息。`)
                let scrollPosition = chat.scrollTop() + message.position().top;
                chat.animate({ scrollTop: scrollPosition }, 500);
            } else {
                console.error(`Timelines: 未找到 ${chatSessionName} 中的第 ${messageId} 条消息。`);
            }
        }
    } finally {
        closeOpenDrawers();
    }
}

/**
 * 关闭所有未固定的抽屉。
 * It also toggles the display icons and manages the animation during the transition.
 */
// TODO: The `openDrawer` style class appears nowhere else in this project.
// TODO: Does Timelines need this to interact with the main parts of ST (which does use `openDrawer`), or is this actually a no-op?
// This is currently called from:
//   - The handler registered to `cy.ready` (`index.js`)
//   - `onTimelineButtonClick` (`index.js`)
//   - 从 `navigateToMessage` 返回时（`src/utils.js`）
export function closeOpenDrawers() {
    var openDrawers = $('.openDrawer').not('.pinnedOpen');

    openDrawers.addClass('resizing').slideToggle(200, 'swing', function () {
        $(this).closest('.drawer-content').removeClass('resizing');
    });

    $('.openIcon').toggleClass('closedIcon openIcon');
    openDrawers.toggleClass('closedDrawer openDrawer');
}

/**
 * 关闭 ID 为 "timelinesModal" 的模态框。
 * It ensures the modal is returned to its original position in the DOM when closed.
 */
export function closeModal() {
    let modal = document.getElementById('timelinesModal');
    if (!modal) {
        console.error('Timelines: 未找到模态框。');
        return;
    }

    // Append the modal back to its original parent (to store it while closed)
    document.querySelector('.timelines-modal-storage').appendChild(modal);
    modal.style.display = 'none';
}

/**
 * Hides the Tippy tooltip. Used when closing the timeline view.
 */
export function closeTippy() {
    let tippyBoxes = document.querySelectorAll('.tippy-box');
    tippyBoxes.forEach(box => {
        let parent = box.parentElement;
        if (parent && parent._tippy) {  // `_tippy` is stored on the graph element
            parent._tippy.hide();
            parent._tippy = null;
        }
    });
}

/**
 * Manages the display state and behavior of the modal with ID "timelinesModal".
 * - Appends the modal to the body and shows it when called.
 * - Appends the modal back to its original parent in the DOM when it's closed.
 * - 点击关闭按钮或模态框外部区域时关闭模态框。
 */
export function handleModalDisplay() {
    let modal = document.getElementById('timelinesModal');
    if (!modal) {
        console.error('Timelines: 未找到模态框。');
        return;
    }

    let closeBtn = modal.getElementsByClassName('close')[0];
    if (!closeBtn) {
        console.error('Timelines: 未找到关闭按钮。');
        return;
    }

    // The "close" button
    closeBtn.onclick = function () {
        closeModal();
        closeTippy();
    };

    // When clicked outside
    //
    // How do you detect a click *outside*? How this works, for other non-native JS speakers:
    // The modal is built out of two parts:
    //   - An outer div (`timelinesModal`, the "outer modal") covers the whole viewport (hence, it catches the click here)
    //   - An inner div (`networkContainer`, the "inner modal") covers only part of the viewport, and has the actual content of the modal
    // See e.g. https://wesbos.com/javascript/06-serious-practice-exercises/click-outside-modal
    modal.onclick = function (event) {
        if (event.target == modal) {  // outer div itself clicked (as opposed to something inside it clicked)
            closeModal();
            closeTippy();
        }
    };

    // Append the modal to the document body to show it
    document.body.appendChild(modal);
    modal.style.display = 'block';
}

/**
 * Navigates to a specific swipe within the last message of a chat, based on the given swipe ID, and updates the chat data and UI accordingly.
 *
 * This function adjusts the chat data to reflect the content of the specified swipe and updates the UI to display it.
 * It also handles edge cases such as swipe ID bounds and potential cleanup of extra properties.
 *
 * @param {number} targetSwipeId - The ID of the swipe to navigate to.
 * @returns {Promise<void>} Resolves once the swipe navigation and associated updates are complete.
 *
 * Behavior:
 * 1. Sets the desired swipe ID and validates its bounds.
 * 2. Adjusts the chat data to reflect the content of the specified swipe.
 * 3. Updates the UI to display the new message data.
 * 4. Optionally updates the token count for the message if enabled.
 * 5. Emits a 'MESSAGE_SWIPED' event and saves the chat data.
 */
async function goToSwipe(targetSwipeId) {  // TODO: To avoid duplication, this function could be moved to the main ST frontend?
    if (targetSwipeId === null || targetSwipeId === undefined) {
        console.error('Timelines: goToSwipe: 未提供 swipe ID，无法切换。');
        return;
    }

    const context = getTimelinesContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    if (chat.length === 0) {
        console.error('Timelines: 当前聊天为空，无法切换 swipe。');
        return;
    }
    const lastMessageId = chat.length - 1;
    const lastMessageObj = chat[lastMessageId];
    if (!Array.isArray(lastMessageObj?.swipes) || lastMessageObj.swipes.length === 0) {
        console.error('Timelines: 最后一条消息没有可切换的 swipes。');
        return;
    }

    // Reset with wraparound if exceeding bounds
    console.debug(`Timelines: goToSwipe: 请求将最后一条消息切换到第 ${targetSwipeId + 1} 个 swipe。`);
    if (targetSwipeId < 0) {
        targetSwipeId = lastMessageObj['swipes'].length - 1;
    } else if (targetSwipeId >= lastMessageObj['swipes'].length) {
        targetSwipeId = 0;
    }

    // Set the swipe ID
    console.debug(`Timelines: goToSwipe: 边界检查后，将最后一条消息切换到第 ${targetSwipeId + 1} 个 swipe。`);
    lastMessageObj['swipe_id'] = targetSwipeId;
    console.debug(lastMessageObj);

    // Update chat data based on the new swipe ID
    if (!Array.isArray(lastMessageObj['swipe_info'])) {
        lastMessageObj['swipe_info'] = [];
    }
    lastMessageObj['mes'] = lastMessageObj['swipes'][targetSwipeId];
    lastMessageObj['send_date'] = lastMessageObj.swipe_info[targetSwipeId]?.send_date || lastMessageObj.send_date;
    lastMessageObj['extra'] = cloneSwipeExtra(lastMessageObj.swipe_info[targetSwipeId]?.extra, lastMessageObj.extra);

    // Clean up any extra properties if needed
    if (lastMessageObj.extra) {
        if (lastMessageObj.extra.memory) delete lastMessageObj.extra.memory;
        if (lastMessageObj.extra.display_text) delete lastMessageObj.extra.display_text;
    }

    // Update UI with the new message data
    addOneMessage(lastMessageObj, { type: 'swipe' });

    // Update token count if enabled
    if (power_user.message_token_count_enabled) {
        const swipeMessageElement = $('#chat').find(`[mesid="${lastMessageId}"]`);
        const tokenCount = getTokenCount(lastMessageObj.mes, 0);
        lastMessageObj['extra']['token_count'] = tokenCount;
        swipeMessageElement.find('.tokenCounterDisplay').text(`${tokenCount}t`);
    }
    await eventSource.emit(event_types.MESSAGE_SWIPED, lastMessageId);
    saveChatDebounced();
}
