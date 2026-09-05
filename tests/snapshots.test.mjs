import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTimelineSnapshots,
  filterSnapshots,
  formatSnapshotsMarkdown,
  getPrimaryChatFile,
} from '../src/snapshot-service.js';

test('getPrimaryChatFile extracts primary chat name across different structures', () => {
  assert.equal(getPrimaryChatFile(null), '');
  assert.equal(getPrimaryChatFile({ chat_sessions: { 'chapter-1.jsonl': true } }), 'chapter-1.jsonl');
  assert.equal(getPrimaryChatFile({ chat_id: 'chat-42' }), 'chat-42');
  assert.equal(getPrimaryChatFile({ chat: 'my-chat.jsonl' }), 'my-chat.jsonl');
});

test('extractTimelineSnapshots handles empty and null inputs safely', () => {
  assert.deepEqual(extractTimelineSnapshots(null), []);
  assert.deepEqual(extractTimelineSnapshots([]), []);
  assert.deepEqual(extractTimelineSnapshots({ nodes: () => [] }), []);
});

test('extractTimelineSnapshots extracts roots, bookmarks, tags, and branch points in chronological order', () => {
  const mockNodes = [
    {
      id: () => 'node-0',
      data: () => ({
        id: 'node-0',
        message: 'Opening of the adventure.',
        depth: 0,
        is_user: false,
        name: 'Narrator',
      }),
      incomers: () => [],
      outgoers: () => [{ id: 'e1' }, { id: 'e2' }], // branch point!
    },
    {
      id: () => 'node-1',
      data: () => ({
        id: 'node-1',
        message: 'Regular chat turn without milestone.',
        depth: 1,
        is_user: true,
      }),
      incomers: () => [{ id: 'e1' }],
      outgoers: () => [{ id: 'e3' }],
    },
    {
      id: () => 'node-2',
      data: () => ({
        id: 'node-2',
        message: 'Victory over the dragon!',
        depth: 5,
        is_user: false,
        name: 'Hero',
        bookmark: true,
        extra: { snapshotTitle: 'Dragon Defeated', tags: ['boss-fight'] },
      }),
      incomers: () => [{ id: 'e3' }],
      outgoers: () => [],
    },
    {
      id: () => 'cluster-node',
      data: () => ({
        id: 'cluster-node',
        isCluster: true,
        message: 'Collapsed LOD node',
      }),
    },
  ];

  const snapshots = extractTimelineSnapshots({ nodes: () => mockNodes });

  // node-0 is Root and Branch Point; node-2 has bookmark & custom title.
  // node-1 is not a milestone, cluster-node is ignored.
  assert.equal(snapshots.length, 2);

  // Chronological order: messageId 0 then messageId 5
  assert.equal(snapshots[0].messageId, 0);
  assert.equal(snapshots[0].isRoot, true);
  assert.equal(snapshots[0].isBranchPoint, true);

  assert.equal(snapshots[1].messageId, 5);
  assert.equal(snapshots[1].title, 'Dragon Defeated');
  assert.equal(snapshots[1].isBookmark, true);
  assert.equal(snapshots[1].tags.length, 1);
  assert.equal(snapshots[1].tags[0].name, 'boss-fight');
});

test('filterSnapshots accurately filters by title, tag, speaker, and floor', () => {
  const sample = [
    { title: 'Tavern Gathering', speaker: 'Bartender', tags: [{ name: 'prologue' }], messageId: 1, previewText: 'Welcome traveler' },
    { title: 'Forest Ambush', speaker: 'Goblin', tags: [{ name: 'combat' }], messageId: 8, previewText: 'Give me your gold' },
    { title: 'Castle Throne', speaker: 'King', tags: [{ name: 'royalty' }], messageId: 25, previewText: 'Kneel before me' },
  ];

  assert.equal(filterSnapshots(sample, '').length, 3);
  assert.equal(filterSnapshots(sample, 'tavern').length, 1);
  assert.equal(filterSnapshots(sample, 'combat').length, 1);
  assert.equal(filterSnapshots(sample, 'goblin').length, 1);
  assert.equal(filterSnapshots(sample, '25').length, 1);
  assert.equal(filterSnapshots(sample, 'nonexistent').length, 0);
});

test('formatSnapshotsMarkdown outputs valid markdown structure', () => {
  const sample = [
    {
      title: 'First Battle',
      speaker: 'Knight',
      is_user: false,
      chatFile: 'adventure-main.jsonl',
      messageId: 3,
      tags: [{ name: 'battle' }],
      previewText: 'Prepare your sword and shield!',
    },
  ];

  const md = formatSnapshotsMarkdown(sample, { character: 'Eldoria' });
  assert.ok(md.includes('时光机剧情快照与存档清单'));
  assert.ok(md.includes('Eldoria'));
  assert.ok(md.includes('First Battle'));
  assert.ok(md.includes('#battle'));
  assert.ok(md.includes('Prepare your sword and shield!'));
});
