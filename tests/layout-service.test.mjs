import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutService } from '../src/layout-service.js';

test('layoutService gracefully degrades when Worker is undefined in Node', async () => {
    const cyElements = [
        { group: 'nodes', data: { id: 'root' } },
        { group: 'nodes', data: { id: 'node1' } },
        { group: 'edges', data: { id: 'e1', source: 'root', target: 'node1' } },
    ];

    const result = await layoutService.computeLayout(cyElements, {
        nodeWidth: 30,
        nodeHeight: 30,
        rankDir: 'LR',
    });

    // In Node.js without Worker, it must return success: false without throwing
    assert.equal(result.success, false);
    assert.equal(result.positions, null);
});

test('layoutService terminate can be invoked safely', () => {
    assert.doesNotThrow(() => {
        layoutService.terminate();
    });
});
