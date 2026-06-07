import test from 'node:test';
import assert from 'node:assert/strict';

import {
    cloneSwipeExtra,
    escapeRegExp,
    getAlphaFromColor,
    makeContextKey,
    normalizeMessageText,
} from '../src/helpers.js';

test('escapeRegExp escapes search fragments that have regex syntax', () => {
    const escaped = escapeRegExp('a(b)[c].*?+^$|\\');
    const regex = new RegExp(escaped);

    assert.equal(regex.test('a(b)[c].*?+^$|\\'), true);
});

test('getAlphaFromColor uses explicit alpha for rgba colors', () => {
    assert.equal(getAlphaFromColor('rgba(10, 20, 30, 0.35)'), 0.35);
});

test('getAlphaFromColor treats hex and rgb colors as fully opaque', () => {
    assert.equal(getAlphaFromColor('#ADD8E6'), 1);
    assert.equal(getAlphaFromColor('rgb(10, 20, 30)'), 1);
});

test('makeContextKey changes when character, group, or chat changes', () => {
    const base = makeContextKey({ characterId: 1, groupId: null, chatId: 'a', chat: [{ mes: 'x' }] });
    const changedChat = makeContextKey({ characterId: 1, groupId: null, chatId: 'b', chat: [{ mes: 'x' }] });
    const changedGroup = makeContextKey({ characterId: null, groupId: 'g2', chatId: 'a', chat: [{ mes: 'x' }] });

    assert.notEqual(base, changedChat);
    assert.notEqual(base, changedGroup);
});

test('normalizeMessageText does not mutate the original message', () => {
    const message = { mes: 'hello\r\nworld' };

    assert.equal(normalizeMessageText(message), 'hello\nworld');
    assert.equal(message.mes, 'hello\r\nworld');
});

test('cloneSwipeExtra returns an empty object when swipe and message extras are missing', () => {
    assert.deepEqual(cloneSwipeExtra(undefined, undefined), {});
});

test('cloneSwipeExtra deep-clones swipe extra before falling back to message extra', () => {
    const swipeExtra = { nested: { value: 1 } };
    const cloned = cloneSwipeExtra(swipeExtra, { fallback: true });

    cloned.nested.value = 2;
    assert.equal(swipeExtra.nested.value, 1);
    assert.deepEqual(cloned, { nested: { value: 2 } });
});
