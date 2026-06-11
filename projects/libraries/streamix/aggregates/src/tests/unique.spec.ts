import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { unique } from '@epikodelabs/streamix/aggregates';

describe('unique', () => {
  let source$: Atom<any>;
  let source: Stream<any>;

  beforeEach(() => {
    source$ = atom<any>();
    source = fromAtom(source$);
  });

  it('should emit only unique values', async () => {
    const uniqueStream = source.pipe(unique());
    const results: any[] = [];

    void (async () => {
      for await (const value of uniqueStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(2); // Duplicate, should not emit
    source$.set(3);
    source$.set(1); // Duplicate, should not emit
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([1, 2, 3]);
  });

  it('should emit unique values based on the keySelector', async () => {
    const uniqueStream = source.pipe(unique(value => value.key));
    const results: any[] = [];

    void (async () => {
      for await (const value of uniqueStream) {
        results.push(value);
      }
    })();

    source$.set({ key: 1, value: 'a' });
    source$.set({ key: 2, value: 'b' });
    source$.set({ key: 1, value: 'c' }); // Same key, should not emit
    source$.set({ key: 3, value: 'd' });
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([
      { key: 1, value: 'a' },
      { key: 2, value: 'b' },
      { key: 3, value: 'd' },
    ]);
  });

  it('should emit all values when no key selector is provided', async () => {
    const uniqueStream = source.pipe(unique());
    const results: any[] = [];

    void (async () => {
      for await (const value of uniqueStream) {
        results.push(value);
      }
    })();

    source$.set({ value: 'a' });
    source$.set({ value: 'a' }); // Duplicate, should not emit
    source$.set({ value: 'b' });
    source$.set({ value: 'c' });
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([
      { value: 'a' },
      { value: 'a' },
      { value: 'b' },
      { value: 'c' },
    ]);
  });

  it('should handle an empty stream gracefully', async () => {
    const uniqueStream = source.pipe(unique());
    const results: any[] = [];

    void (async () => {
      for await (const value of uniqueStream) {
        results.push(value);
      }
    })();

    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([]); // No values emitted
  });

  it('should propagate errors from the source stream', async () => {
    const uniqueStream = source.pipe(unique());
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of uniqueStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    source$.setError(new Error('Test Error'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(error).toEqual(new Error('Test Error'));
  });

  it('should handle complex objects correctly', async () => {
    const uniqueStream = source.pipe(unique(value => value.id));
    const results: any[] = [];

    void (async () => {
      for await (const value of uniqueStream) {
        results.push(value);
      }
    })();

    source$.set({ id: 1, name: 'John' });
    source$.set({ id: 2, name: 'Jane' });
    source$.set({ id: 1, name: 'John' }); // Duplicate, should not emit
    source$.set({ id: 3, name: 'Jake' });
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([
      { id: 1, name: 'John' },
      { id: 2, name: 'Jane' },
      { id: 3, name: 'Jake' },
    ]);
  });
});
