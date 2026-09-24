import {
  atom,
} from '@epikodelabs/streamix';

import {
  createBindingTable,
  rendererScheduler,
  ɵsxProperty,
  ɵsxText,
} from '../lib';

idescribe('sx binding table hardening', () => {
  afterEach(() => {
    rendererScheduler.flushNow();
  });

  it('coalesces repeated writes to each slot', () => {
    const count = atom(0);
    const disabled = atom(false);

    const text = document.createTextNode('');
    const button = document.createElement('button');

    const table = createBindingTable(2);

    ɵsxText(table, 0, text, count);
    ɵsxProperty(
      table,
      1,
      button,
      'disabled',
      disabled,
    );

    count.set(1);
    count.set(2);
    count.set(3);

    disabled.set(true);
    disabled.set(false);
    disabled.set(true);

    expect(rendererScheduler.pendingCount).toBe(1);

    rendererScheduler.flushNow();

    expect(text.data).toBe('3');
    expect(button.disabled).toBeTrue();

    table.destroy();
  });

  it('ignores emissions after table destruction', () => {
    const count = atom(1);
    const text = document.createTextNode('');

    const table = createBindingTable(1);
    ɵsxText(table, 0, text, count);

    expect(text.data).toBe('1');

    table.destroy();
    count.set(2);

    rendererScheduler.flushNow();

    expect(text.data).toBe('1');
  });
});
import { idescribe } from '../../../src/tests/env.spec';
