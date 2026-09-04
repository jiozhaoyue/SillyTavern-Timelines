import { extension_settings, getContext } from '../../../../extensions.js';
import { characters, getThumbnailUrl } from '../../../../../script.js';
import { power_user } from '../../../../power-user.js';
import { getAlphaFromColor } from './helpers.js';

function getTimelinesContext() {
    return window.Luker?.getContext?.() ?? getContext();
}

import { highlightPathToRoot } from './graph-builder.js';

export { highlightPathToRoot };

/**
 * Sets up visual styles for nodes and edges based on provided node data and context settings.
 * This function prepares styles that are to be used with Cytoscape to visually represent a graph.
 * Depending on extension settings and context, different colors, shapes, and styles are applied to nodes and edges.
 * Additionally, paths from checkpoint nodes to the root are highlighted.
 *
 * @param {Object} nodeData - Data structure representing the graph with nodes and edges.
 * @returns {Array} An array of style definitions suitable for use with Cytoscape.
 */
export function setupStylesAndData(nodeData) {
    const context = getTimelinesContext();
    let selected_group = context.groupId;
    let group = context.groups.find(group => group.id === selected_group);
    let this_chid = context.characterId;
    const avatarImg = selected_group
        ? group?.avatar_url
        : characters[this_chid]?.avatar
            ? getThumbnailUrl('avatar', characters[this_chid].avatar)
            : 'none';

    let theme = {};
    if (extension_settings.timeline.useChatColors) {
        theme.charNodeColor = power_user.main_text_color;
        theme.edgeColor = power_user.italics_text_color;
        theme.userNodeColor = power_user.quote_text_color;
        theme.bookmarkColor = 'rgba(255, 215, 0, 1)'; // 金色
    }
    else {
        theme.charNodeColor = extension_settings.timeline.charNodeColor;
        theme.edgeColor = extension_settings.timeline.edgeColor;
        theme.userNodeColor = extension_settings.timeline.userNodeColor;
        theme.bookmarkColor = extension_settings.timeline.bookmarkColor;
    }

    const nodeMap = new Map();
    const incomingEdgeMap = new Map();
    const bookmarkNodes = [];

    const rawEntries = Array.isArray(nodeData) ? nodeData : Object.values(nodeData || {});
    for (const entry of rawEntries) {
        if (!entry?.data?.id) continue;
        if (entry.group === 'nodes') {
            nodeMap.set(entry.data.id, entry);
            if (entry.data.isBookmark) {
                bookmarkNodes.push(entry);
            }
        } else if (entry.group === 'edges' && entry.data.target) {
            incomingEdgeMap.set(entry.data.target, entry);
        }
    }

    bookmarkNodes.forEach(bookmarkNode => {
        highlightPathToRoot(nodeMap, incomingEdgeMap, bookmarkNode);
    });

    if (extension_settings.timeline.swipeScale) {
        for (const entry of nodeMap.values()) {
            const totalSwipes = Number(entry.data?.totalSwipes) || 0;
            if (totalSwipes > 0) {
                const add = Math.abs(Math.log(totalSwipes + 1)) * 4;
                entry.data.nodeWidth = add + Number(extension_settings.timeline.nodeWidth);
                entry.data.nodeHeight = add + Number(extension_settings.timeline.nodeHeight);
            }
        }
    }

    const cytoscapeStyles = [
        {
            selector: 'edge',
            style: {
                'curve-style': extension_settings.timeline.curveStyle,
                'taxi-direction': 'rightward',
                'segment-distances': [5, 5],
                'line-color': theme.edgeColor,
                'line-opacity': getAlphaFromColor(theme.edgeColor),
                'width': 3,
                'z-index': 1,
            },
        },
        {
            selector: 'edge[?isHighlight]',
            style: {
                'line-color': 'data(color)',
                'line-opacity': 1,
                'width': 'data(highlightThickness)',
                'z-index': 'data(zIndex)',
            },
        },
        {
            selector: 'edge[?isSwipe]',
            style: {
                'line-style': 'dashed',
                'line-opacity': .5,
            },
        },
        {
            selector: 'node',
            style: {
                'width': extension_settings.timeline.nodeWidth,
                'height': extension_settings.timeline.nodeHeight,
                'shape': extension_settings.timeline.nodeShape,
                'background-color': theme.charNodeColor,
                'background-opacity': getAlphaFromColor(theme.charNodeColor),
                'border-color': 'black',
                'border-width': 0,
                'border-style': 'solid',
                'border-opacity': 0,
            },
        },
        {
            selector: 'node[?nodeWidth]',
            style: {
                'width': 'data(nodeWidth)',
                'height': 'data(nodeHeight)',
            },
        },
        {
            selector: 'node[?is_user]',
            style: {
                'background-color': theme.userNodeColor,
                'background-opacity': getAlphaFromColor(theme.userNodeColor),
            },
        },
        {
            selector: 'node[totalSwipes > 0]',
            style: {
                'border-style': 'double',
                'border-width': 5,
                'border-opacity': 1,
                'border-color': theme.charNodeColor,
            },
        },
        {
            selector: 'node[totalSwipes > 0][?is_user]',
            style: {
                'border-color': theme.userNodeColor,
            },
        },
        {
            selector: 'node[?borderColor]',
            style: {
                'border-color': 'data(borderColor)',
                'border-width': 3,
                'border-opacity': 1,
            },
        },
        {
            selector: 'node[?isBookmark]',
            style: {
                'border-color': theme.bookmarkColor,
                'border-width': 5,
                'border-opacity': getAlphaFromColor(theme.bookmarkColor),
            },
        },
        {
            selector: 'node[label="root"]',
            style: {
                'background-image': extension_settings.timeline.avatarAsRoot ? avatarImg : 'none',
                'background-fit': extension_settings.timeline.avatarAsRoot ? 'cover' : 'none',
                'width': extension_settings.timeline.avatarAsRoot ? '40px' : extension_settings.timeline.nodeWidth,
                'height': extension_settings.timeline.avatarAsRoot ? '50px' : extension_settings.timeline.nodeHeight,
                'shape': extension_settings.timeline.avatarAsRoot ? 'rectangle' : extension_settings.timeline.nodeShape,
            },
        },
        {
            selector: 'node[?is_system]',
            style: {
                'background-color': 'grey',
                'border-style': 'dashed',
                'border-width': 3,
                'border-color': 'grey',
                'border-opacity': 1,
            },
        },
        {
            selector: 'node[?isSwipe]',
            style: {
                'background-opacity': .5,
                'border-width': 3,
                'border-color': 'grey',
                'border-style': 'dashed',
                'border-opacity': 1,
            },
        },
        {
            selector: '.NoticeMe',
            style: {
                'background-opacity': 0.5,
            },
        },
    ];

    return cytoscapeStyles;
}

/**
 * Highlights specific elements (nodes or edges) in a Cytoscape graph based on a given selector.
 */
export function highlightElements(cy, selector) {
    if (!cy) return;

    cy.batch(() => {
        cy.elements().style({ 'opacity': 0.2 });

        let underlayPadding = '5px';
        let underlayShape = 'ellipse';

        if (((typeof selector === "string") || (selector instanceof String)) && selector.startsWith('edge')) {
            let match = selector.match(/color="([^"]+)"/);
            if (match) {
                let colorValue = match[1];
                let nodeSelector = `node[borderColor="${colorValue}"]`;
                cy.elements(nodeSelector).style({
                    'opacity': 1,
                    'underlay-color': 'white',
                    'underlay-padding': '2px',
                    'underlay-opacity': 0.5,
                    'underlay-shape': 'ellipse',
                });
            }
            underlayPadding = '2px';
            underlayShape = '';
        }

        cy.elements(selector).style({
            'opacity': 1,
            'underlay-color': 'white',
            'underlay-padding': underlayPadding,
            'underlay-opacity': 0.5,
            'underlay-shape': underlayShape,
        });
    });
}

/**
 * Restores all elements in a Cytoscape graph to their default visual state.
 */
export function restoreElements(cy) {
    if (!cy) return;
    cy.batch(() => {
        cy.elements().style({
            'opacity': 1,
            'underlay-color': '',
            'underlay-padding': '',
            'underlay-opacity': '',
            'underlay-shape': '',
        });
    });
}
