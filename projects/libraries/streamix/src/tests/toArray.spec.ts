import {
  createOperator,
  createSubject,
  getIteratorMeta,
  getValueMeta,
  setIteratorMeta,
  type Stream,
  toArray
} from '@epikodelabs/streamix';

describe('toArray', () => {
  let subject: ReturnType<typeof createSubject<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it('should collect all values and emit them as an array when the stream completes', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2, 3]]);
  });

  it('should emit an empty array when the stream completes without emitting any values', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    subject.complete(); // No values emitted, just completing
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[]]); // Empty array
  });

  it('should propagate errors from the source stream', async () => {
    const toArrayStream = source.pipe(toArray());
    let error: any = null;

    (async () => {
      try {
        for await (const _ of toArrayStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.error(new Error('Test Error'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toEqual(new Error('Test Error'));  // Propagate error
  });

  it('should handle the stream completing after emitting values', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    subject.next(10);
    subject.next(20);
    subject.next(30);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[10, 20, 30]]);
  });

  it('should handle an edge case where only one value is emitted', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    subject.next(42); // Single value
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[42]]);  // Single value in array
  });

  it('should attach collapse metadata when upstream iterator has meta', async () => {
    const tagIds = createOperator<number, number>('tagIds', function (source) {
      let n = 0;
      const iterator: AsyncIterator<number> = {
        next: async () => {
          const result = await source.next();
          if (result.done) return result;

          n += 1;
          setIteratorMeta(iterator as any, { valueId: `id${n}` }, 0, 'tagIds');
          return result;
        },
      };
      return iterator;
    });

    const toArrayStream = source.pipe(tagIds, toArray());
    const it = toArrayStream[Symbol.asyncIterator]();

    subject.next(1);
    subject.next(2);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([1, 2]);

    expect(getIteratorMeta(it as any)).toEqual(
      jasmine.objectContaining({
        valueId: 'id2',
        kind: 'collapse',
        inputValueIds: ['id1', 'id2'],
      })
    );

    expect(getValueMeta(r1.value)).toEqual(
      jasmine.objectContaining({
        valueId: 'id2',
        kind: 'collapse',
        inputValueIds: ['id1', 'id2'],
      })
    );

    const r2 = await it.next();
    expect(r2.done).toBe(true);

    const r3 = await it.next();
    expect(r3.done).toBe(true);
  });
});


