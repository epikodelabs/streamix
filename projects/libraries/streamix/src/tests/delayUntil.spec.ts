import { atom, delayUntil, from, iterate, pipe, type SourceCapabilities } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('delayUntil', () => {
  it('should delay emissions until the condition stream emits a value', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    source.next(1);
    condition.next('start');
    source.next(2);
    source.next(3);
    source.next(4);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([1, 2, 3, 4]);
  });

  it('should not emit any values if condition stream does not emit', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([]);
  });

  it('should drop values after notifier completes without emitting', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    condition.dispose();
    source.next(1);
    source.next(2);
    source.dispose();

    await reader;
    expect(emittedValues).toEqual([]);
  });

  it('should flush buffered values if the notifier emits after the source completes', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.dispose();

    await wait(0);
    condition.next('start');

    await reader;
    expect(emittedValues).toEqual([1, 2]);
  });

  it('should emit the source stream values after condition stream emits', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    condition.next('start');
    source.next(10);
    source.next(20);
    source.next(30);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([10, 20, 30]);
  });

  it('should handle error in source stream', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(source, delayUntil(condition)))) {
        void _;
      }
    })();

    source.next(1);
    source.fail(new Error('Something went wrong'));
    condition.next('start');

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Something went wrong' }));
  });

  it('should propagate notifier errors', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(source, delayUntil(condition)))) {
        void _;
      }
    })();

    source.next(7);
    condition.fail(new Error('Notifier failed'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Notifier failed' }));
  });

  it('should flush buffer when notifier promise resolves', async () => {
    const source = atom<number>();
    const notifier$ = new Promise<void>((resolve) => setTimeout(resolve, 20));

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(notifier$)))) {
        emittedValues.push(value);
      }
    })();

    source.next(8);
    source.next(9);

    await wait(40);
    source.dispose();

    await reader;
    expect(emittedValues).toEqual([8, 9]);
  });

  it('should complete the stream after both source and condition streams complete', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    condition.next('start');
    source.next(5);
    source.next(6);
    source.next(7);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([5, 6, 7]);
  });

  it('supports synchronous draining helpers after an immediate notifier emission', async () => {
    const iterator = delayUntil(from([true])).apply(iterate(from([1, 2]))[Symbol.asyncIterator]()) as AsyncIterator<number> & SourceCapabilities<number>;

    await wait(0);

    expect(iterator.hasBufferedEvents?.()).toBeTrue();
    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: 1, done: false } });
    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: 2, done: false } });
    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: undefined, done: true } });
    expect(iterator.hasBufferedEvents?.()).toBeFalse();
    expect(iterator.isTerminal?.()).toBeTrue();
    expect(await iterator.return?.('closed')).toEqual({ value: 'closed', done: true });
  });

  it('reports empty terminal state without buffered events', async () => {
    const iterator = delayUntil(from([])).apply(from<number>([])[Symbol.asyncIterator]()) as AsyncIterator<number> & SourceCapabilities<number>;

    expect(iterator.pollSync?.()).toEqual({ status: 'available', result: { value: undefined, done: true } });
    expect(iterator.hasBufferedEvents?.()).toBeFalse();
    expect(iterator.isTerminal?.()).toBeTrue();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    await iterator.return?.();
    expect(iterator.hasBufferedEvents?.()).toBeFalse();
  });

  it('reports held values while the gate is closed and discards them on return', async () => {
    const notifier = atom<void>();
    let emitted = false;
    const source: AsyncIterator<number> & SourceCapabilities<number> = {
      next: async () => ({ value: undefined, done: true }),
      pollSync: () => {
        if (emitted) return { status: 'available', result: { value: undefined, done: true } };
        emitted = true;
        return { status: 'available', result: { value: 1, done: false } };
      },
      hasBufferedEvents: () => false,
    };
    const iterator = delayUntil(notifier).apply(source) as AsyncIterator<number> & SourceCapabilities<number>;
    try {
      expect(iterator.pollSync?.()).toEqual({ status: 'unavailable' });
      expect(iterator.hasBufferedEvents?.()).toBeTrue();
      expect(iterator.isTerminal?.()).toBeFalse();
      await iterator.return?.();
      expect(iterator.hasBufferedEvents?.()).toBeFalse();
      expect(iterator.isTerminal?.()).toBeTrue();
    } finally {
      await iterator.return?.();
      notifier.dispose();
    }
  });
});
