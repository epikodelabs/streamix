import { createStream, shareReplay } from '@epikodelabs/streamix';

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

describe('shareReplay', () => {
  it('should replay last emitted value to new subscribers', async () => {
    let executionCount = 0;

    const source = createStream<number>('source', async function* () {
      executionCount++;
      yield 42;
    });

    const shared$ = source.pipe(shareReplay());

    const values1: number[] = [];
    const values2: number[] = [];

    shared$.subscribe({
      next: val => values1.push(val),
      complete: () => {}
    });

    await waitFor(() => values1.length === 1);

    // Second subscription after completion
    shared$.subscribe({
      next: val => values2.push(val),
      complete: () => {}
    });

    await waitFor(() => values2.length === 1);

    expect(values1).toEqual([42]);
    expect(values2).toEqual([42]);
    expect(executionCount).toBe(1);
  });

  it('should propagate error to all subscribers', async () => {
    const source = createStream<number>('erroring', async function* () {
      yield 1;
      throw new Error('Test error');
    });

    const shared$ = source.pipe(shareReplay());

    let errorCount = 0;
    let completed = false;
    shared$.subscribe({
      next: () => {},
      error: (err) => {
        expect(err).toEqual(new Error('Test error'));
        errorCount++;
      },
      complete: () => { completed = true; },
    });

    shared$.subscribe({
      next: () => {},
      error: (err) => {
        expect(err).toEqual(new Error('Test error'));
        errorCount++;
      },
      complete: () => { completed = true; },
    });

    await waitFor(() => errorCount === 2);
    expect(completed).toBeFalse();
  });

  it('should support async bufferSize and replay the last N values', async () => {
    let executionCount = 0;

    const source = createStream<number>('source', async function* () {
      executionCount++;
      yield 1;
      yield 2;
      yield 3;
    });

    const shared$ = source.pipe(shareReplay(Promise.resolve(2)));

    const values1: number[] = [];
    const values2: number[] = [];

    shared$.subscribe({
      next: v => values1.push(v),
      complete: () => {}
    });

    await waitFor(() => values1.length === 3);

    shared$.subscribe({
      next: v => values2.push(v),
      complete: () => {}
    });

    await waitFor(() => values2.length === 2);

    expect(values1).toEqual([1, 2, 3]);
    expect(values2).toEqual([2, 3]);
    expect(executionCount).toBe(1);
  });

  it('should cancel additional source iterators once connected', async () => {
    let executionCount = 0;
    let iteratorCount = 0;
    let returnCalls = 0;

    const source = createStream<number>('source', async function* () {
      executionCount++;
      yield 1;
      await new Promise(resolve => setTimeout(resolve, 25));
      yield 2;
    });

    const originalAsyncIterator = (source as any)[Symbol.asyncIterator].bind(source);
    (source as any)[Symbol.asyncIterator] = () => {
      iteratorCount++;
      const it = originalAsyncIterator();
      const originalReturn = it.return?.bind(it);
      if (originalReturn) {
        it.return = (...args: any[]) => {
          returnCalls++;
          return originalReturn(...args);
        };
      }
      return it;
    };

    const shared$ = source.pipe(shareReplay());

    const values1: number[] = [];
    const values2: number[] = [];

    shared$.subscribe({ next: v => values1.push(v) });
    await waitFor(() => values1.length === 1);

    // Subscribe while the shared source is still active.
    shared$.subscribe({ next: v => values2.push(v) });

    await waitFor(() => values1.length === 2);
    await waitFor(() => values2.length === 2);

    expect(values1).toEqual([1, 2]);
    expect(values2).toEqual([1, 2]);
    expect(executionCount).toBe(1);
    expect(iteratorCount).toBeGreaterThanOrEqual(2);
    expect(returnCalls).toBeGreaterThanOrEqual(1);
  });

  it('calls return() on subsequent source iterators when already connected (operator-level)', async () => {
    const op = shareReplay<number>();

    let source2ReturnCalls = 0;
    let source2ReturnRejected = false;

    let i = 0;
    const source1: AsyncIterator<number> = {
      next: async () => {
        i += 1;
        return i === 1 ? { value: 1, done: false } : { value: undefined, done: true };
      },
    };

    const source2: AsyncIterator<number> = {
      next: async () => ({ value: undefined, done: true }),
      return: async () => {
        source2ReturnCalls += 1;
        source2ReturnRejected = true;
        throw new Error('return rejected');
      },
    };

    // First apply connects to source1.
    (op as any).apply(source1);

    // Second apply should immediately cancel source2.
    (op as any).apply(source2);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(source2ReturnCalls).toBe(1);
    expect(source2ReturnRejected).toBe(true);
  });
});


