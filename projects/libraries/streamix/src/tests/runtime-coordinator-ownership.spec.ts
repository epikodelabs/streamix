import { createAsyncCoordinator } from '../lib/utils/coordinator';

describe('runtime coordinator ownership', () => {
  it('never drains a synchronous fast path past an outstanding async pull', async () => {
    let resolve!: (value: IteratorResult<number>) => void;
    let pulls = 0;
    const source = {
      next() {
        pulls++;
        return new Promise<IteratorResult<number>>(r => { resolve = r; });
      },
      __tryNext() { return { done: false as const, value: 999 }; },
      async return() { return { done: true as const, value: undefined }; }
    };
    // Force a pull by initially reporting no synchronous value.
    let fast = false;
    const originalTry = source.__tryNext;
    source.__tryNext = () => fast ? originalTry() : null as any;
    const coordinator = createAsyncCoordinator([source], { syncDrain: true });
    expect(pulls).toBe(1);
    fast = true;
    expect(coordinator.__tryNext!()).toBeNull();
    expect(pulls).toBe(1);
    resolve({ done: false, value: 1 });
    expect((await coordinator.next()).value).toEqual({ type: 'value', value: 1, sourceIndex: 0 });
    await coordinator.return!();
  });

  it('closes each owned source once even with concurrent return calls', async () => {
    let returns = 0;
    const source = {
      next: () => new Promise<IteratorResult<number>>(() => {}),
      return: async () => { returns++; return { done: true as const, value: undefined }; }
    };
    const coordinator = createAsyncCoordinator([source], { syncDrain: true });
    await Promise.all([coordinator.return!(), coordinator.return!()]);
    expect(returns).toBe(1);
    expect((await coordinator.next()).done).toBe(true);
  });
});
