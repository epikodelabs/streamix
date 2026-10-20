import { createAsyncCoordinator } from '../lib/utils/coordinator';
import { internalRuntime } from '../lib/runtime/runtime';

describe('runtime-coordinated source events', () => {
  it('delivers source events in order without touching the runtime dispatcher', async () => {
    // Transport runs on a private per-coordinator bus: the runtime dispatcher
    // is the diagnostics gate, and observing it must never capture transport
    // events or pay for them in production.
    const seen: Array<{ kind: string; value: unknown }> = [];
    const unobserve = internalRuntime.events.observe(event => {
      if (event.value && typeof event.value === 'object' && 'sourceIndex' in event.value) {
        seen.push({ kind: event.kind, value: event.value });
      }
    });
    const source: AsyncIterator<number> = {
      next: (() => {
        let count = 0;
        return () => count++ === 0
          ? Promise.resolve({ done: false as const, value: 42 })
          : Promise.resolve({ done: true as const, value: undefined });
      })()
    };
    const coordinator = createAsyncCoordinator([source]);
    try {
      expect((await coordinator.next()).value).toEqual({ type: 'value', value: 42, sourceIndex: 0 });
      expect((await coordinator.next()).value).toEqual({ type: 'complete', sourceIndex: 0 });
      expect(seen).toEqual([]);
    } finally {
      unobserve();
      await coordinator.return?.();
    }
  });

  it('isolates independent coordinators from each other', async () => {
    const a = createAsyncCoordinator<number>([{ next: () => Promise.resolve({ done: false, value: 1 }) }]);
    const b = createAsyncCoordinator<number>([{ next: () => Promise.resolve({ done: false, value: 2 }) }]);
    try {
      const [first, second] = await Promise.all([a.next(), b.next()]);
      expect(first.value).toEqual({ type: 'value', value: 1, sourceIndex: 0 });
      expect(second.value).toEqual({ type: 'value', value: 2, sourceIndex: 0 });
    } finally {
      await Promise.all([a.return?.(), b.return?.()]);
    }
  });

  it('does not publish late source events after cancellation', async () => {
    let resolve!: (result: IteratorResult<number>) => void;
    const source: AsyncIterator<number> = {
      next: () => new Promise(r => { resolve = r; }),
      return: async () => ({ done: true, value: undefined })
    };
    const coordinator = createAsyncCoordinator([source]);
    const pending = coordinator.next();
    await coordinator.return?.();
    resolve({ done: false, value: 99 });
    expect((await pending).done).toBe(true);
    expect((await coordinator.next()).done).toBe(true);
  });
});
