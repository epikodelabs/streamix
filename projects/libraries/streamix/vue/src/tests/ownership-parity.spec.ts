import { atom, scope, type Scope } from '@epikodelabs/streamix';
import { effectScope } from 'vue';
import { useScope } from '../lib/useScope';
import { createBindingTable } from '../../../angular/src/lib/binding-table';
import { RendererScheduler } from '../../../angular/src/lib/render-scheduler';

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
});
