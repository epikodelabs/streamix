import { concatMap, flow, from, iterate, atom as makeAtom, pipe, type Atom, type Writable } from '@epikodelabs/streamix';

describe('concatMap', () => {
  const waitTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  let project: (value: any) => any;

  beforeEach(() => {
    project = (value: any) => [`innerValue${value}`];
  });

  it('should handle errors in inner stream without affecting other emissions', async () => {
    const values = ['1', '2'];
    const atom = pipe(
      from(values),
      concatMap((value: any) => (value === '2' ? errorInnerSource() : project(value)))
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

  it('passes incrementing outer indices to the projection', async () => {
    const seen: Array<[string, number]> = [];
    const emittedValues: string[] = [];
    const atom = pipe(
      from(['a', 'b', 'c']),
      concatMap((value, index) => {
        seen.push([value, index]);
        return [`${index}:${value}`];
      })
    );

    for await (const value of iterate(atom)) {
      emittedValues.push(value);
    }

    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect(emittedValues).toEqual(['0:a', '1:b', '2:c']);
  });

  it('edge: should queue rapid successive emissions and process sequentially', async () => {
    const source: Writable<number> = makeAtom<number>();
    const results: number[] = [];
    const order: string[] = [];

    const atom = pipe(
      source,
      concatMap((val) => {
        order.push(`start-${val}`);
        const inner: Writable = makeAtom<number>();
        setTimeout(() => {
          inner.next(val * 10);
          inner.dispose();
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
    source.dispose();

    await reader;

    expect(results).toEqual([10, 20, 30]);
    expect(order).toEqual([
      'start-1', 'end-1',
      'start-2', 'end-2',
      'start-3', 'end-3'
    ]);
  });

  it('edge: should handle mix of sync and async inners in order', async () => {
    const source: Writable<number> = makeAtom<number>();
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
    source.dispose();

    await reader;

    expect(results).toEqual([10, 20, 30, 40]);
  });

  it('edge: should handle rapid emissions with empty inners', async () => {
    const source: Writable<number> = makeAtom<number>();
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
    source.dispose();

    await reader;

    expect(results).toEqual([10, 30]);
  });

  it('edge: should stop on first inner error in rapid emissions', async () => {
    const source: Writable<number> = makeAtom<number>();
    const results: number[] = [];
    let caughtError: Error | undefined;

    const atom = pipe(
      source,
      concatMap((val) => {
        const inner: Writable = makeAtom<number>();
        setTimeout(() => {
          if (val === 2) {
            inner.fail(new Error('Error at 2'));
          } else {
            inner.next(val * 10);
            inner.dispose();
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
    source.dispose();

    await reader;

    expect(caughtError?.message).toBe('Error at 2');
    expect(results).toEqual([10]);
  });

  it('tears down the active inner iterator and source on return', async () => {
    const innerReturn = jasmine.createSpy('innerReturn').and.resolveTo({ value: undefined, done: true });
    const sourceReturn = jasmine.createSpy('sourceReturn').and.resolveTo({ value: undefined, done: true });
    let outerCalls = 0;

    const source = {
      async next() {
        outerCalls++;
        if (outerCalls === 1) {
          return { value: 1, done: false as const };
        }

        return new Promise<IteratorResult<number>>(() => {});
      },
      return: sourceReturn,
    } as AsyncIterator<number>;

    const iterator = concatMap<number, number>(() => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return new Promise<IteratorResult<number>>(() => {});
          },
          return: innerReturn,
        };
      },
    })).apply(source);

    void iterator.next();
    await waitTick();

    expect(await iterator.return?.('stop')).toEqual({ value: undefined, done: true });
    expect(innerReturn).toHaveBeenCalled();
    expect(sourceReturn).toHaveBeenCalled();
  });
});

// Error Handling Stream using library's `flow`
export function errorInnerSource(): Atom {
  return flow(async function* () {
    throw new Error('Inner Stream Error');
  });
}
