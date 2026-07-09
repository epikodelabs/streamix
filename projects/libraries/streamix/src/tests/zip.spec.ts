import { atom, from, zip } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('zip', () => {
  it('should zip values from multiple streams', async () => {
    const stream1$ = from([1, 2, 3]);
    const stream2$ = from(['a', 'b', 'c']);
    const stream3$ = from([true, false, true]);

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([
      [1, 'a', true],
      [2, 'b', false],
      [3, 'c', true],
    ]);
  });

  it('should emit nothing when one source is empty', async () => {
    const stream1$ = from([] as any[]);
    const stream2$ = from(['a', 'b', 'c']);
    const stream3$ = from([true, false, true]);

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([]);
  });

  it('should zip until the shortest stream completes', async () => {
    const stream1$ = from([1, 2]);
    const stream2$ = from(['a', 'b', 'c']);
    const stream3$ = from([true, false, true, false]);

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([
      [1, 'a', true],
      [2, 'b', false],
    ]);
  });

  it('should handle sources that emit values asynchronously', async () => {
    const stream1$ = atom<number>();
    const stream2$ = atom<string>();
    const stream3$ = atom<boolean>();

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe(v => { if (v !== undefined) result.push(v); });

    stream1$.next(1);
    stream2$.next('a');
    stream3$.next(true);

    stream1$.next(2);
    stream2$.next('b');
    stream3$.next(false);

    stream1$.dispose();
    stream2$.dispose();
    stream3$.dispose();

    await delay();

    expect(result).toEqual([
      [1, 'a', true],
      [2, 'b', false],
    ]);
  });

  it('should zip promise-based sources', async () => {
    const zipped = zip(Promise.resolve(from([1, 2])), Promise.resolve(from(['a', 'b'])));
    const result: any[] = [];

    zipped.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('should emit nothing when no sources are provided', async () => {
    const zipped = zip();
    const result: any[] = [];

    zipped.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay(50);

    expect(result).toEqual([]);
  });

  it('should propagate source errors', async () => {
    const source = atom<number>();
    const zipped = zip(source, from(['a']));

    const pending = (async () => {
      const values: any[] = [];
      for await (const value of zipped as any) {
        values.push(value);
      }
      return values;
    })();

    const error = new Error('zip boom');
    source.fail(error);

    await expectAsync(pending).toBeRejectedWith(error);
  });
});
