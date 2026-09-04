import test from 'node:test';
import assert from 'node:assert/strict';

import { timelinesCache } from '../src/cache.js';

test('timelinesCache storage key formatting', () => {
    const key = timelinesCache.makeStorageKey('char_123', '2024-01-01 @12h.jsonl');
    assert.equal(key, 'char_123::2024-01-01 @12h');
});

test('timelinesCache setChat and getChat roundtrip in memory fallback', async () => {
    const scope = 'char_test_1';
    const fileName = 'chat_a.jsonl';
    const messages = [
        { name: 'AI', mes: 'Hello world', send_date: '12:00' },
        { name: 'User', mes: 'Hi there', send_date: '12:01' },
    ];

    await timelinesCache.setChat(scope, fileName, messages);
    const cached = await timelinesCache.getChat(scope, fileName);

    assert.ok(cached !== null);
    assert.equal(cached.fileName, fileName);
    assert.equal(cached.messageCount, 2);
    assert.equal(cached.lastMessageText, 'Hi there');
    assert.equal(cached.lastMessageDate, '12:01');
    assert.deepEqual(cached.messages, messages);
});

test('timelinesCache getBatchChats retrieves multiple files efficiently', async () => {
    const scope = 'char_test_batch';
    await timelinesCache.setChat(scope, 'file1.jsonl', [{ mes: 'msg1' }]);
    await timelinesCache.setChat(scope, 'file2.jsonl', [{ mes: 'msg2' }]);

    const batch = await timelinesCache.getBatchChats(scope, ['file1.jsonl', 'file2.jsonl', 'file3_missing.jsonl']);
    assert.equal(batch.size, 2);
    assert.ok(batch.has('file1.jsonl'));
    assert.ok(batch.has('file2.jsonl'));
    assert.ok(!batch.has('file3_missing.jsonl'));
    assert.equal(batch.get('file1.jsonl').messages[0].mes, 'msg1');
});

test('timelinesCache clearScope removes only specified scope', async () => {
    const scopeA = 'char_scope_A';
    const scopeB = 'char_scope_B';

    await timelinesCache.setChat(scopeA, 'a1.jsonl', [{ mes: 'A' }]);
    await timelinesCache.setChat(scopeB, 'b1.jsonl', [{ mes: 'B' }]);

    await timelinesCache.clearScope(scopeA);

    const checkA = await timelinesCache.getChat(scopeA, 'a1.jsonl');
    const checkB = await timelinesCache.getChat(scopeB, 'b1.jsonl');

    assert.equal(checkA, null);
    assert.ok(checkB !== null);
});

test('timelinesCache getStorageUsage returns reasonable estimates', async () => {
    const usage = await timelinesCache.getStorageUsage();
    assert.ok(typeof usage.chatCount === 'number');
    assert.ok(typeof usage.estimatedBytes === 'number');
    assert.ok(usage.chatCount >= 1);
    assert.ok(usage.estimatedBytes > 0);
});

test('timelinesCache clearAll empties all records', async () => {
    await timelinesCache.clearAll();
    const usage = await timelinesCache.getStorageUsage();
    assert.equal(usage.chatCount, 0);
    assert.equal(usage.estimatedBytes, 0);
});
