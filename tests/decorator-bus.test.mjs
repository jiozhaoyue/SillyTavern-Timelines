import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerNodeDecorator,
  unregisterNodeDecorator,
  getNodeDecorators,
  registerToolbarAction,
  getToolbarActions,
  registerContextMenuAction,
  getContextMenuActions,
} from '../src/api.js';

test('registerNodeDecorator orders decorators by priority and supports unregister', () => {
  unregisterNodeDecorator('test-low');
  unregisterNodeDecorator('test-high');

  const ok1 = registerNodeDecorator({
    id: 'test-low',
    priority: 50,
    decorateNode: () => {},
  });
  const ok2 = registerNodeDecorator({
    id: 'test-high',
    priority: 5,
    decorateNode: () => {},
  });

  assert.equal(ok1, true);
  assert.equal(ok2, true);

  const decorators = getNodeDecorators();
  const highIndex = decorators.findIndex(d => d.id === 'test-high');
  const lowIndex = decorators.findIndex(d => d.id === 'test-low');

  assert.ok(highIndex < lowIndex, 'Higher priority decorator should execute before lower priority');

  const removed = unregisterNodeDecorator('test-low');
  assert.equal(removed, true);
  const updated = getNodeDecorators();
  assert.equal(updated.some(d => d.id === 'test-low'), false);
});

test('registerToolbarAction and registerContextMenuAction register modular items', () => {
  registerToolbarAction({
    id: 'custom-tool-1',
    title: 'Custom Action',
    iconClass: 'fa-solid fa-star',
    onToggle: () => {},
  });

  const tools = getToolbarActions();
  assert.ok(tools.some(t => t.id === 'custom-tool-1'));

  registerContextMenuAction({
    id: 'custom-menu-1',
    content: 'Custom Menu Item',
    onClick: () => {},
  });

  const menus = getContextMenuActions();
  assert.ok(menus.some(m => m.id === 'custom-menu-1'));
});
