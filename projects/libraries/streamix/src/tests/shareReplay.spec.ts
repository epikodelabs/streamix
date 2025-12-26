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

    await waitFor(() => errorCount === 2 && completed);
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
});


