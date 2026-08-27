import { abortError, combineSignals, fromTask, raceAbort } from '@epikodelabs/streamix/networking';

async function first<T>(stream: AsyncIterable<T>): Promise<T> {
  const iterator = stream[Symbol.asyncIterator]();
  const result = await iterator.next();
  if (result.done) throw new Error('Stream completed without a value');
  await iterator.return?.();
  return result.value;
}

describe('task and abort helpers', () => {
  it('creates a one-value stream from a task', async () => {
    expect(await first(fromTask(async () => 42))).toBe(42);
  });

  it('aborts a task when its iterator is closed', async () => {
    let observedAbort = false;
    const stream = fromTask<number>(async (signal) => {
      await raceAbort(
        signal,
        new Promise<number>((resolve) => setTimeout(() => resolve(1), 50)),
      ).catch((error) => {
        observedAbort = error.name === 'AbortError';
        throw error;
      });
      return 1;
    });

    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next();
    await iterator.return?.();
    await pending.catch(() => {});

    expect(observedAbort).toBeTrue();
  });

  it('combines abort signals', () => {
    const first = new AbortController();
    const second = new AbortController();
    const signal = combineSignals(first.signal, second.signal);

    second.abort(abortError());

    expect(signal.aborted).toBeTrue();
  });
});
