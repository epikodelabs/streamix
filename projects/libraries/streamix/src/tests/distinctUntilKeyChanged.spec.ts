import { atom, fromAtom, distinctUntilKeyChanged, type Stream, type Atom } from '@epikodelabs/streamix';

describe('distinctUntilKeyChanged', () => {
  let source$: Atom<any>;
  let source: Stream<any>;

  beforeEach(() => {
    source$ = atom<any>();
    source = fromAtom(source$);
  });

  it('should emit values with distinct keys', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    source$.set({ key: 1, value: 'a' });
    source$.set({ key: 1, value: 'b' }); // same key, skip
    source$.set({ key: 2, value: 'c' }); // new key, emit
    source$.set({ key: 2, value: 'd' }); // same key, skip
    source$.set({ key: 3, value: 'e' }); // new key, emit
    source$.dispose();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 1, value: 'a' },
      { key: 2, value: 'c' },
      { key: 3, value: 'e' },
    ]);
  });

  it('should emit the first value regardless of key', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    source$.set({ key: 1, value: 'a' }); // emit
    source$.set({ key: 1, value: 'b' }); // same key, skip
    source$.set({ key: 1, value: 'c' }); // same key, skip
    source$.dispose();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 1, value: 'a' },
    ]);
  });

  it('should handle an empty stream gracefully', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    source$.dispose();

    await consumptionPromise;

    expect(results).toEqual([]);
  });

  it('should propagate errors from the source stream', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    let error: any = null;

    const consumptionPromise = (async () => {
      try {
        for await (const _ of distinctStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    source$.setError(new Error('Test Error'));

    await consumptionPromise;

    expect(error).toEqual(new Error('Test Error'));
  });

  it('should resolve promised keys before filtering values', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged(Promise.resolve('key')));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    source$.set({ key: 1, value: 'a' });
    source$.set({ key: 1, value: 'b' });
    source$.set({ key: 2, value: 'c' });
    source$.dispose();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 1, value: 'a' },
      { key: 2, value: 'c' },
    ]);
  });

  it('should work with promise-based comparators', async () => {
    const comparator = (prev: number, curr: number) => Promise.resolve(prev === curr);
    const distinctStream = source.pipe(distinctUntilKeyChanged('key', comparator));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    source$.set({ key: 5, value: 'first' });
    source$.set({ key: 5, value: 'skip' });
    source$.set({ key: 6, value: 'second' });
    source$.set({ key: 6, value: 'skip again' });
    source$.dispose();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 5, value: 'first' },
      { key: 6, value: 'second' },
    ]);
  });
});


