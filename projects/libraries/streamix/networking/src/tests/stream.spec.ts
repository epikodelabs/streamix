import { flow, type Stream } from '@epikodelabs/streamix/networking';

async function first<T>(stream: Stream<T>): Promise<T> {
  const iterator = stream[Symbol.asyncIterator]();
  const result = await iterator.next();
  await iterator.return?.();
  if (result.done) throw new Error('Stream completed without a value');
  return result.value;
}

describe('stream', () => {
  it('creates an independent iterator per consumer', async () => {
    let runs = 0;
    const stream = flow(async function* () {
      yield ++runs;
    });

    expect(await first(stream)).toBe(1);
    expect(await first(stream)).toBe(2);
  });

  it('aborts the factory signal when the iterator is returned', async () => {
    let signal!: AbortSignal;
    const stream = flow<number>(async function* (currentSignal) {
      signal = currentSignal;
      yield 1;
      await new Promise(() => {});
    });

    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe(1);
    expect(signal.aborted).toBeFalse();

    await iterator.return?.();

    expect(signal.aborted).toBeTrue();
  });
});
