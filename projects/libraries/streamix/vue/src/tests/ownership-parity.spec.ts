import { atom, scope, type Scope } from '@epikodelabs/streamix';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { effectScope } from 'vue';
import { useScope } from '../lib/useScope';
import { useIterable } from '../lib/useIterable';
import { useStreamixSource } from '../../../react/src/lib/runtime';
import { createBindingTable } from '../../../angular/src/lib/binding-table';
import { RendererScheduler } from '../../../angular/src/lib/render-scheduler';

import { idescribe } from './env.spec';

const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('framework ownership cleanup parity', () => {
  it('Vue releases owned scopes even when setup work throws', () => {
    const owner = effectScope();
    let created!: Scope;
    try {
      expect(() => owner.run(() => {
        created = useScope(() => scope({ count: 1 }));
        throw new Error('abandoned setup');
      })).toThrowError('abandoned setup');
    } finally { owner.stop(); }
    expect(created._disposed).toBeTrue();
  });

  it('Angular releases failed-view subscriptions without disposing external sources', () => {
    const source = atom(1);
    const baseline = source.subscriberCount ?? 0;
    let queued: (() => void) | undefined;
    const scheduler = new RendererScheduler({ schedule(callback) {
      queued = callback;
      return () => { queued = undefined; };
    } });
    const table = createBindingTable(1, scheduler);
    try {
      const write = jasmine.createSpy('write');
      table.bind(0, source, write);
      expect(source.subscriberCount).toBe(baseline + 1);
      source.next(2);
      expect(queued).toBeDefined();
      table.destroy();
      expect(scheduler.pendingCount).toBe(0);
      write.calls.reset();
      queued?.();
      expect(write).not.toHaveBeenCalled();
      expect(source.subscriberCount).toBe(baseline);
      expect(source.disposed).toBeFalse();
    } finally { table.destroy(); source.dispose(); }
  });

  it('Vue releases a removed row bridge subscription exactly once', () => {
    const source = atom(1);
    const baseline = source.subscriberCount ?? 0;
    const row = effectScope();
    let bridge!: { readonly value: number };

    row.run(() => {
      bridge = useIterable(source, 0, 'row.value');
    });

    expect(bridge.value).toBe(1);
    expect(source.subscriberCount).toBe(baseline + 1);

    source.next(2);
    expect(bridge.value).toBe(2);

    // Stopping the row's effect scope — what Vue does when a list row
    // unmounts — releases the bridge subscription exactly once. Later
    // emissions reach nothing and must not re-subscribe.
    row.stop();
    expect(source.subscriberCount).toBe(baseline);

    source.next(3);
    expect(source.subscriberCount).toBe(baseline);
  });
});

idescribe('framework ownership cleanup parity (browser)', () => {
  it('React releases a removed row source subscription exactly once', async () => {
    const source = atom(1);
    const baseline = source.subscriberCount ?? 0;
    let rendered: number | undefined;

    function Row() {
      rendered = useStreamixSource(source, 'row.value');
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const rowRoot = createRoot(host);
    try {
      await act(async () => { rowRoot.render(createElement(Row)); });

      expect(rendered).toBe(1);
      expect(source.subscriberCount).toBe(baseline + 1);

      await act(async () => { rowRoot.unmount(); });
      // The unsubscribe is deferred one task to batch StrictMode cycles.
      await nextTask();

      expect(source.subscriberCount).toBe(baseline);

      // Emissions after unmount reach no component and must not re-subscribe.
      source.next(2);
      await nextTask();
      expect(rendered).toBe(1);
      expect(source.subscriberCount).toBe(baseline);
    } finally {
      host.remove();
      source.dispose();
    }
  });
});
