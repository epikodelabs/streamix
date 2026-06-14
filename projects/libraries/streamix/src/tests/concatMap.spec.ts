import { concatMap, createStream, createSubject, from, iterate, pipe, type Stream } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('concatMap', () => {

  let project: (value: any) => any;

  beforeEach(() => {
    project = (value: any) => [`innerValue${value}`];
  });

  it('should handle errors in inner stream without affecting other emissions', async () => {
    const values = ['1', '2'];
    const atom = pipe(
      from(values),
      concatMap((value: any) => (value === '2' ? errorInnerStream() : project(value)))
    );

    const emittedValues: any[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const value of iterate(atom)) {
        emittedValues.push(value);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    expect(emittedValues).toEqual(['innerValue1']);
    expect(caughtError?.message).toEqual('Inner Stream Error');
  });

  it('should handle an empty stream', async () => {
    const atom = pipe(from([]), concatMap(project));
    const emittedValues: any[] = [];

    for await (const value of iterate(atom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual([]);
  });

  it('should project values and subscribe to inner stream in sequence', async () => {
    const atom = pipe(from(['1', '2', '3', '4', '5']), concatMap(project));
    const emittedValues: any[] = [];

    for await (const value of iterate(atom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual(['innerValue1', 'innerValue2', 'innerValue3', 'innerValue4', 'innerValue5']);
  });

  it('should complete inner stream before processing next outer emission', async () => {
    const emissions = ['1', '2', '3'];
    const atom = pipe(from(emissions), concatMap((value: any) => [value]));
    const emittedValues: any[] = [];

    for await (const value of iterate(atom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual(emissions);
  });

  it('should correctly concatenate emissions from both outer and inner streams', async () => {
    const outerValues = ['outer1', 'outer2'];
    const innerValues1 = ['inner1a', 'inner1b'];
    const innerValues2 = ['inner2a', 'inner2b'];

    const projectFn = (value: any) => {
      return value === 'outer1' ? innerValues1 : innerValues2;
    };

    const atom = pipe(from(outerValues), concatMap(projectFn));
    const emittedValues: any[] = [];

    for await (const value of iterate(atom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual(['inner1a', 'inner1b', 'inner2a', 'inner2b']);
  });

  it('edge: should queue rapid successive emissions and process sequentially', async () => {
    const source = createSubject<number>();
    const results: number[] = [];
    const order: string[] = [];

    const atom = pipe(
      source,
      concatMap((val) => {
        order.push(`start-${val}`);
        const inner = createSubject<number>();
        setTimeout(() => {
          inner.next(val * 10);
          inner.complete();
          order.push(`end-${val}`);
        }, (4 - val) * 20);
        return inner;
      })
    );

    const reader = (async () => {
      for await (const val of iterate(atom)) {
        results.push(val);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    source.complete();

    await reader;

    expect(results).toEqual([10, 20, 30]);
    expect(order).toEqual([
      'start-1', 'end-1',
      'start-2', 'end-2',
      'start-3', 'end-3'
    ]);
  });

  it('edge: should handle mix of sync and async inners in order', async () => {
    const source = createSubject<number>();
    const results: number[] = [];

    const atom = pipe(
      source,
      concatMap((val) => {
        if (val % 2 === 0) {
          return new Promise<number>((resolve) => {
            setTimeout(() => resolve(val * 10), 50);
          });
        }
        return [val * 10];
      })
    );

    const reader = (async () => {
      for await (const val of iterate(atom)) {
        results.push(val);
      }
    })();

    source.next(1); // sync
    source.next(2); // async
    source.next(3); // sync
    source.next(4); // async
    source.complete();

    await reader;

    expect(results).toEqual([10, 20, 30, 40]);
  });

  it('edge: should handle rapid emissions with empty inners', async () => {
    const source = createSubject<number>();
    const results: number[] = [];

    const atom = pipe(
      source,
      concatMap((val) => {
        if (val === 2) {
          return [];
        }
        return [val * 10];
      })
    );

    const reader = (async () => {
      for await (const val of iterate(atom)) {
        results.push(val);
      }
    })();

    source.next(1);
    source.next(2); // empty
    source.next(3);
    source.complete();

    await reader;

    expect(results).toEqual([10, 30]);
  });

  it('edge: should stop on first inner error in rapid emissions', async () => {
    const source = createSubject<number>();
    const results: number[] = [];
    let caughtError: Error | undefined;

    const atom = pipe(
      source,
      concatMap((val) => {
        const inner = createSubject<number>();
        setTimeout(() => {
          if (val === 2) {
            inner.error(new Error('Error at 2'));
          } else {
            inner.next(val * 10);
            inner.complete();
          }
        }, 20);
        return inner;
      })
    );

    const reader = (async () => {
      try {
        for await (const val of iterate(atom)) {
          results.push(val);
        }
      } catch (err) {
        caughtError = err as Error;
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3); // Should never process
    source.complete();

    await reader;

    expect(caughtError?.message).toBe('Error at 2');
    expect(results).toEqual([10]);
  });
});

// Error Handling Stream using library's `createStream`
export function errorInnerStream(): Stream {
  return createStream('errorInnerStream', async function* () {
    throw new Error('Inner Stream Error');
  });
}
