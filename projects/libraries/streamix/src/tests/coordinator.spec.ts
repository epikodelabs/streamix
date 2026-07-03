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
});
