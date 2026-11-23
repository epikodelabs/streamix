import { createAsyncCoordinator, DONE } from '@epikodelabs/streamix';

describe('createAsyncCoordinator', () => {
  it('restores source push handlers when returned', async () => {
    const originalOnPush = () => {};
    const source: AsyncIterator<number> & { __onPush?: () => void } = {
      __onPush: originalOnPush,
      next: async () => new Promise<IteratorResult<number>>(() => {}),
      return: async () => DONE,
    };

    const coordinator = createAsyncCoordinator([source]);

    expect(source.__onPush).not.toBe(originalOnPush);
    await coordinator.return?.();
    expect(source.__onPush).toBe(originalOnPush);
  });

  it('restores source push handlers when a source is removed', async () => {
    const originalOnPush = () => {};
    const source: AsyncIterator<number> & { __onPush?: () => void } = {
      __onPush: originalOnPush,
      next: async () => new Promise<IteratorResult<number>>(() => {}),
      return: async () => DONE,
    };

    const coordinator = createAsyncCoordinator<number>();
    const index = coordinator.addSource(source);

    expect(source.__onPush).not.toBe(originalOnPush);
    await coordinator.removeSource(index);
    expect(source.__onPush).toBe(originalOnPush);

    await coordinator.return?.();
  });

  it('settles every pending read before awaiting stalled cleanup', async () => {
    let finish!: (result: typeof DONE) => void;
    const close = jasmine.createSpy('return').and.callFake(
      () => new Promise<typeof DONE>(resolve => { finish = resolve; }),
    );
    const coordinator = createAsyncCoordinator([{
      next: () => new Promise<IteratorResult<number>>(() => {}),
      return: close,
    }]);
    const first = coordinator.next();
    const second = coordinator.next();
    const stopping = coordinator.return!();
    const repeated = coordinator.return!();
    expect(await first).toEqual(DONE);
    expect(await second).toEqual(DONE);
    expect(close).toHaveBeenCalledTimes(1);
    finish(DONE);
    await Promise.all([stopping, repeated]);
  });
});
