import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeLowestCommonAncestor,
  getChatBranchNodes,
  getLineageFromElements,
  notifyBranchSwitched,
  registerTimelinesExtensionApi,
  setTimelineGraphState,
} from '../src/api.js';
import {
  buildMemoryIndexForGraph,
  createQuickMemoryEvent,
  getEventInjectionStatus,
  getMemoryBundleForMessage,
  getMemoryGraphApi,
  isMemoryGraphAvailable,
} from '../src/memory-graph-service.js';

test('memory-graph-service: graceful degradation when api not present', async () => {
  const dummyContext = { getExtensionApi: () => null };
  assert.equal(getMemoryGraphApi(dummyContext), null);
  assert.equal(isMemoryGraphAvailable(dummyContext), false);

  const bundle = await getMemoryBundleForMessage(dummyContext, 4);
  assert.equal(bundle, null);

  const status = getEventInjectionStatus(dummyContext, 'evt-1');
  assert.equal(status, 'none');

  const index = await buildMemoryIndexForGraph(dummyContext, [{ data: { id: 'm1', messageId: 1 } }]);
  assert.equal(index.size, 0);

  const createRes = await createQuickMemoryEvent(dummyContext, { messageIndex: 1, title: 'T', summary: 'S' });
  assert.equal(createRes.success, false);
});

test('memory-graph-service: resolves bundle and injection status with mock api', async () => {
  const mockApi = {
    getAssistantSeqForMessageIndex: (_ctx, idx) => (idx === 2 ? 1 : idx === 4 ? 2 : null),
    findEventBundleBySeq: async (_ctx, seq) => {
      if (seq === 1) {
        return {
          event: { id: 'evt-1', title: '与艾莉亚在酒馆初遇' },
          location: { id: 'loc-1', title: '风袭城酒馆' },
          characters: [{ id: 'char-1', title: '艾莉亚' }],
        };
      }
      return null;
    },
    getCurrentInjection: (_ctx) => ({
      alwaysInjectIds: new Set(['evt-0']),
      recallSelectedIds: new Set(['evt-1']),
      visibleIds: new Set(['evt-2']),
    }),
  };

  const mockCtx = {
    getExtensionApi: (name) => (name === 'memory-graph' ? mockApi : null),
  };

  assert.equal(isMemoryGraphAvailable(mockCtx), true);

  // Message 2 -> seq 1 -> has bundle
  const bundle = await getMemoryBundleForMessage(mockCtx, 2, mockApi);
  assert.ok(bundle);
  assert.equal(bundle.event.id, 'evt-1');
  assert.equal(bundle.location.title, '风袭城酒馆');
  assert.equal(bundle.characters.length, 1);

  // Message 4 -> seq 2 -> no bundle
  const emptyBundle = await getMemoryBundleForMessage(mockCtx, 4, mockApi);
  assert.equal(emptyBundle, null);

  // Check injection statuses
  assert.equal(getEventInjectionStatus(mockCtx, 'evt-0', mockApi), 'always');
  assert.equal(getEventInjectionStatus(mockCtx, 'evt-1', mockApi), 'recall');
  assert.equal(getEventInjectionStatus(mockCtx, 'evt-2', mockApi), 'visible');
  assert.equal(getEventInjectionStatus(mockCtx, 'evt-999', mockApi), 'none');

  // Build index for elements
  const elements = [
    { group: 'nodes', data: { id: 'root', messageId: 0 } },
    { group: 'nodes', data: { id: 'msg1', messageId: 2 } },
    { group: 'nodes', data: { id: 'msg2', messageId: 4 } },
  ];

  const memIndex = await buildMemoryIndexForGraph(mockCtx, elements, mockApi);
  assert.equal(memIndex.size, 1);
  assert.ok(memIndex.has('msg1'));
  assert.equal(memIndex.get('msg1').injectionStatus, 'recall');
  assert.equal(memIndex.get('msg1').bundle.event.title, '与艾莉亚在酒馆初遇');
});

test('memory-graph-service: creates memory event via openSession', async () => {
  let createdPayload = null;
  const mockApi = {
    openSession: async (_ctx) => ({
      createNode: async (op) => {
        createdPayload = op;
        return { id: 'new-node-123' };
      },
    }),
  };

  const res = await createQuickMemoryEvent(
    {},
    { messageIndex: 5, title: '签订契约', summary: '在古树前签订魔法誓约' },
    mockApi,
  );
  assert.equal(res.success, true);
  assert.equal(res.id, 'new-node-123');
  assert.equal(createdPayload.type, 'event');
  assert.equal(createdPayload.title, '签订契约');
  assert.equal(createdPayload.fields.floorRange.start, 5);
});

test('api: getLineageFromElements traces ancestral causal chain', () => {
  // Tree structure:
  // root -> n1 -> n2 -> n3
  //            -> n4
  const elements = [
    { data: { id: 'root' } },
    { data: { id: 'n1' } },
    { data: { id: 'n2' } },
    { data: { id: 'n3' } },
    { data: { id: 'n4' } },
    { data: { id: 'e1', source: 'root', target: 'n1' } },
    { data: { id: 'e2', source: 'n1', target: 'n2' } },
    { data: { id: 'e3', source: 'n2', target: 'n3' } },
    { data: { id: 'e4', source: 'n1', target: 'n4' } },
  ];

  const lineageN3 = getLineageFromElements(elements, 'n3');
  assert.deepEqual(lineageN3, ['root', 'n1', 'n2', 'n3']);

  const lineageN4 = getLineageFromElements(elements, 'n4');
  assert.deepEqual(lineageN4, ['root', 'n1', 'n4']);

  const lineageRoot = getLineageFromElements(elements, 'root');
  assert.deepEqual(lineageRoot, ['root']);

  const lineageMissing = getLineageFromElements(elements, 'unknown');
  assert.deepEqual(lineageMissing, ['unknown']);
});

test('api: computeLowestCommonAncestor calculates divergence point', () => {
  const lineageA = ['root', 'n1', 'n2', 'branchA1', 'branchA2'];
  const lineageB = ['root', 'n1', 'n2', 'branchB1'];
  assert.equal(computeLowestCommonAncestor(lineageA, lineageB), 'n2');

  const lineageC = ['root', 'other1'];
  assert.equal(computeLowestCommonAncestor(lineageA, lineageC), 'root');

  assert.equal(computeLowestCommonAncestor([], lineageA), null);
  assert.equal(computeLowestCommonAncestor(['x'], ['y']), null);
});

test('api: getChatBranchNodes filters and sorts by messageId', () => {
  const elements = [
    { data: { id: 'root' } },
    {
      data: {
        id: 'msgB',
        messageId: 3,
        text: 'Hello 3',
        chat_sessions: { 'chat1.jsonl': { messageId: 3 } },
      },
    },
    {
      data: {
        id: 'msgA',
        messageId: 1,
        text: 'Hello 1',
        chat_sessions: { 'chat1.jsonl': { messageId: 1 } },
      },
    },
    {
      data: {
        id: 'msgOther',
        messageId: 2,
        text: 'Other chat',
        chat_sessions: { 'chat2.jsonl': { messageId: 2 } },
      },
    },
  ];

  const branchNodes = getChatBranchNodes(elements, 'chat1.jsonl');
  assert.equal(branchNodes.length, 2);
  assert.equal(branchNodes[0].id, 'msgA');
  assert.equal(branchNodes[0].messageId, 1);
  assert.equal(branchNodes[1].id, 'msgB');
  assert.equal(branchNodes[1].messageId, 3);
});

test('api: registerTimelinesExtensionApi registers clean interface', () => {
  let registeredApi = null;
  const mockContext = {
    registerExtensionApi: (name, api) => {
      if (name === 'timelines') registeredApi = api;
    },
  };

  const registered = registerTimelinesExtensionApi(mockContext);
  assert.equal(registered, true);
  assert.ok(registeredApi);
  assert.equal(typeof registeredApi.getTimelineTree, 'function');
  assert.equal(typeof registeredApi.getBranchLineage, 'function');
  assert.equal(typeof registeredApi.computeBranchLCA, 'function');
  assert.equal(typeof registeredApi.getBranchNodes, 'function');
  assert.equal(typeof registeredApi.onBranchSwitched, 'function');

  // Test state synchronization
  const sampleElements = [
    { data: { id: 'root' } },
    { data: { id: 'n1' } },
    { data: { id: 'e1', source: 'root', target: 'n1' } },
  ];
  setTimelineGraphState(sampleElements, 'chat-main.jsonl');

  assert.equal(registeredApi.getTimelineTree().length, 3);
  assert.deepEqual(registeredApi.getBranchLineage('n1'), ['root', 'n1']);

  // Test branch switch event
  let receivedEvent = null;
  const unsub = registeredApi.onBranchSwitched((evt) => {
    receivedEvent = evt;
  });

  notifyBranchSwitched('chat-branch.jsonl', 'n1');
  assert.deepEqual(receivedEvent, { chatFileName: 'chat-branch.jsonl', nodeId: 'n1' });

  unsub();
  notifyBranchSwitched('chat-3.jsonl', 'n2');
  assert.deepEqual(receivedEvent, { chatFileName: 'chat-branch.jsonl', nodeId: 'n1' }); // unchanged after unsub
});
