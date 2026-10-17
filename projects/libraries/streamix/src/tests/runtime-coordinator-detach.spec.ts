import { createAsyncCoordinator } from '../lib/utils/coordinator';

describe('runtime coordinator source detachment', () => {
  it('settles a pending consumer before a removed source finishes cleanup', async () => {
    let releaseCleanup!: () => void;
    let returns = 0;
    const source = {
      next: () => new Promise<IteratorResult<number>>(() => {}),
      return: () => {
        returns++;
        return new Promise<IteratorResult<number>>(resolve => {
          releaseCleanup = () => resolve({ done: true, value: undefined });
        });
      }
    };
    const coordinator = createAsyncCoordinator([source], { syncDrain: true });
    const waiting = coordinator.next();
    const removing = coordinator.removeSource(0);
    // The waiter must be released even though the source's return() is pending.
    expect((await waiting).done).toBe(true);
    expect(returns).toBe(1);
    releaseCleanup();
    await removing;
  });

  it('does not complete a coordinator while another source remains active', async () => {
    let releaseCleanup!: () => void;
    const first = {
      next: () => new Promise<IteratorResult<number>>(() => {}),
      return: () => new Promise<IteratorResult<number>>(resolve => {
        releaseCleanup = () => resolve({ done: true, value: undefined });
      })
    };
    let resolveSecond!: (value: IteratorResult<number>) => void;
    const second = {
      next: () => new Promise<IteratorResult<number>>(resolve => { resolveSecond = resolve; })
    };
    const coordinator = createAsyncCoordinator([first, second], { syncDrain: true });
    const waiting = coordinator.next();
    const removing = coordinator.removeSource(0);
    resolveSecond({ done: false, value: 42 });
    expect((await waiting).value).toEqual({ type: 'value', value: 42, sourceIndex: 1 });
    releaseCleanup();
    await removing;
    await coordinator.return!();
  });
});
