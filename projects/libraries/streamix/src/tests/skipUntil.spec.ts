import { atom, from, iterate, pipe, skipUntil, type SourceCapabilities } from '@epikodelabs/streamix';

const waitTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('skipUntil', () => {
  it('skips source values before the notifier emits', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, skipUntil(notifier)))) {
        values.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    notifier.next();
    await waitTick();
    source.next(3);
    source.next(4);
    source.dispose();
    notifier.dispose();

    await reader;
    expect(values).toEqual([3, 4]);
  });

  it('drops source backlog when an immediate notifier opens the gate', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2, 3]), skipUntil(from([true]))))) {
      values.push(value);
    }

    expect(values).toEqual([2, 3]);
  });

  it('keeps skipping when the notifier completes without emitting', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, skipUntil(notifier)))) {
        values.push(value);
      }
    })();

    notifier.dispose();
    source.next(1);
    source.next(2);
    source.dispose();

    await reader;
    expect(values).toEqual([]);
  });

  it('propagates notifier errors', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const reader = (async () => {
      for await (const _ of iterate(pipe(source, skipUntil(notifier)))) {
        void _;
      }
    })();

    notifier.fail(new Error('Notifier failed'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Notifier failed' }));
  });

  it('supports iterator teardown helpers directly', async () => {
    const iterator = skipUntil(from([true])).apply(from([1, 2])[Symbol.asyncIterator]()) as AsyncIterator<number> & SourceCapabilities<number>;

    expect(iterator.hasBufferedEvents?.()).toBeFalse();
    expect(await iterator.return?.(123)).toEqual({ value: 123, done: true });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: undefined, done: true } });
    expect(iterator.hasBufferedEvents?.()).toBeFalse();
    expect(iterator.isTerminal?.()).toBeTrue();
  });

  it('polls lazy synchronous inputs without treating completion as buffered data', async () => {
    const iterator = skipUntil(from([true])).apply(from([1, 2])[Symbol.asyncIterator]()) as AsyncIterator<number> & SourceCapabilities<number>;

    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: 2, done: false } });
    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: undefined, done: true } });
    expect(iterator.hasBufferedEvents?.()).toBeFalse();
    expect(iterator.isTerminal?.()).toBeTrue();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    await iterator.return?.();
  });

  it('reports empty terminal state without buffered events', async () => {
    const iterator = skipUntil(from([])).apply(from<number>([])[Symbol.asyncIterator]()) as AsyncIterator<number> & SourceCapabilities<number>;

    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: undefined, done: true } });
    expect(iterator.hasBufferedEvents?.()).toBeFalse();
    expect(iterator.isTerminal?.()).toBeTrue();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    await iterator.return?.();
  });
});
