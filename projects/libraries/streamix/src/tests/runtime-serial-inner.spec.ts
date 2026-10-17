import { SerialInnerExecution } from '../lib/runtime/serial-inner-execution';

describe('runtime serial inner execution', () => {
  it('releases a completed iterator before attaching the next', async () => {
    const execution = new SerialInnerExecution<number>();
    execution.attach((async function* () { yield 1; })());
    expect((await execution.next()).value).toBe(1);
    expect((await execution.next()).done).toBe(true);
    expect(execution.active).toBe(false);
    expect(execution.attach((async function* () { yield 2; })())).toBe(true);
    expect((await execution.next()).value).toBe(2);
  });

  it('cancels an active iterator at most once', async () => {
    let cancellations = 0;
    const execution = new SerialInnerExecution<number>();
    execution.attach({ next: async () => ({ done: false, value: 1 }), return: async () => {
      cancellations++;
      return { done: true, value: undefined };
    } });
    await execution.close();
    await execution.close();
    expect(cancellations).toBe(1);
    expect(execution.active).toBe(false);
  });

  it('rejects an inner iterator attached after closure', async () => {
    const execution = new SerialInnerExecution<number>();
    await execution.close();
    expect(execution.attach((async function* () { yield 1; })())).toBe(false);
  });
});
