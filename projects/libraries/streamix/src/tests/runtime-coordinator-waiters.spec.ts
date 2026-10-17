import { createAsyncCoordinator } from '../lib/utils/coordinator';

describe('runtime coordinator pending consumers', () => {
  it('delivers events to concurrent next callers in FIFO order', async () => {
    let push!: (value: IteratorResult<number>) => void;
    const source: AsyncIterator<number> = {
      next: () => new Promise(resolve => { push = resolve; })
    };
    const coordinator = createAsyncCoordinator([source]);
    const first = coordinator.next();
    const second = coordinator.next();
    push({ done: false, value: 7 });
    expect((await first).value).toEqual({ type: 'value', value: 7, sourceIndex: 0 });
    await coordinator.return?.();
    expect((await second).done).toBe(true);
  });

  it('wakes every waiting consumer on return', async () => {
    const source: AsyncIterator<number> = { next: () => new Promise(() => {}) };
    const coordinator = createAsyncCoordinator([source]);
    const first = coordinator.next();
    const second = coordinator.next();
    await coordinator.return?.();
    expect((await first).done).toBe(true);
    expect((await second).done).toBe(true);
  });

  it('converts synchronous iterator throws into error events', async () => {
    const source: AsyncIterator<number> = {
      next: () => { throw new Error('source failed'); }
    };
    const coordinator = createAsyncCoordinator([source]);
    const event = await coordinator.next();
    expect(event.value?.type).toBe('error');
    expect((event.value as any).error.message).toBe('source failed');
    expect((await coordinator.next()).done).toBe(true);
  });
});
