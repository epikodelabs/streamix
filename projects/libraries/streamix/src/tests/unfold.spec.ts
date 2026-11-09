import { unfold } from '@epikodelabs/streamix';

describe('unfold()', () => {
  it('executes a transition only on the following pull', async () => {
    const called: string[] = [];
    const values = unfold(0, n => {
      called.push(`step ${n}`);
      return n < 2
        ? { value: n, next: () => { called.push(`advance ${n}`); return n + 1; } }
        : null;
    });

    const iterator = values[Symbol.asyncIterator]();
    expect(called).toEqual([]);
    expect(await iterator.next()).toEqual({ done: false, value: 0 });
    expect(called).toEqual(['step 0']);
    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    expect(called).toEqual(['step 0', 'advance 0', 'step 1']);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(called).toEqual(['step 0', 'advance 0', 'step 1', 'advance 1', 'step 2']);
  });

  it('does not advance after cancellation and aborts the source signal', async () => {
    let advanceCount = 0;
    let observedSignal: AbortSignal | undefined;
    const iterator = unfold(1, (_value, signal) => {
      observedSignal = signal;
      return { value: 1, next: () => { advanceCount++; return 2; } };
    })[Symbol.asyncIterator]();

    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    await iterator.return?.();
    expect(advanceCount).toBe(0);
    expect(observedSignal?.aborted).toBe(true);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it('supports async steps and async state transitions', async () => {
    const values: string[] = [];
    for await (const value of unfold(0, async n => n < 3
      ? { value: `#${n}`, next: async () => n + 1 }
      : null)) {
      values.push(value);
    }
    expect(values).toEqual(['#0', '#1', '#2']);
  });

  it('gives each iterator independent traversal state', async () => {
    const numbers = unfold(3, n => n > 0
      ? { value: n, next: () => n - 1 }
      : null);

    const first = numbers[Symbol.asyncIterator]();
    const second = numbers[Symbol.asyncIterator]();
    expect((await first.next()).value).toBe(3);
    expect((await first.next()).value).toBe(2);
    expect((await second.next()).value).toBe(3);
    await first.return?.();
    await second.return?.();
  });
});
