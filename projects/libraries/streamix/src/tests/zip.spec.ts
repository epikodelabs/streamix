import { atom, fromAtom, from, zip } from '@epikodelabs/streamix';

describe('zip', () => {
  it('should zip values from multiple streams', (done) => {
    const stream1$ = from([1, 2, 3]);
    const stream2$ = from(['a', 'b', 'c']);
    const stream3$ = from([true, false, true]);

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual([
          [1, 'a', true],
          [2, 'b', false],
          [3, 'c', true],
        ]);
        done();
      },
      error: (err: any) => done.fail(err),
    });
  });

  it('should complete when one source is empty', (done) => {
    const stream1$ = from([] as any[]);
    const stream2$ = from(['a', 'b', 'c']);
    const stream3$ = from([true, false, true]);

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe({
      next: () => done.fail('Should not emit any values'),
      complete: () => {
        expect(result).toEqual([]);
        done();
      },
      error: (err: any) => done.fail(err),
    });
  });

  it('should zip until the shortest stream completes', (done) => {
    const stream1$ = from([1, 2]);
    const stream2$ = from(['a', 'b', 'c']);
    const stream3$ = from([true, false, true, false]);

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual([
          [1, 'a', true],
          [2, 'b', false],
        ]);
        done();
      },
      error: (err: any) => done.fail(err),
    });
  });

  it('should handle sources that emit values asynchronously', (done) => {
    const stream1Source$ = atom<number>(); const stream1$ = fromAtom(stream1Source$);
    const stream2Source$ = atom<string>(); const stream2$ = fromAtom(stream2Source$);
    const stream3Source$ = atom<boolean>(); const stream3$ = fromAtom(stream3Source$);

    const result: any[] = [];
    zip(stream1$, stream2$, stream3$).subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual([
          [1, 'a', true],
          [2, 'b', false],
        ]);
        done();
      },
      error: (err: any) => done.fail(err),
    });

    setTimeout(() => {
      stream1Source$.set(1);
      stream2Source$.set('a');
      stream3Source$.set(true);

      stream1Source$.set(2);
      stream2Source$.set('b');
      stream3Source$.set(false);

      stream1Source$.dispose();
      stream2Source$.dispose();
      stream3Source$.dispose();
    }, 100);
  });

  it('should zip promise-based sources', (done) => {
    const zipped = zip(Promise.resolve([1, 2]), Promise.resolve(['a', 'b']));
    const result: any[] = [];

    zipped.subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual([
          [1, 'a'],
          [2, 'b'],
        ]);
        done();
      },
      error: (err: any) => done.fail(err),
    });
  });

  it('should complete immediately when no sources are provided', (done) => {
    const zipped = zip();
    const timer = setTimeout(() => done.fail('did not complete'), 50);

    zipped.subscribe({
      next: () => done.fail('should not emit'),
      complete: () => {
        clearTimeout(timer);
        done();
      },
      error: (err: any) => done.fail(err),
    });
  });
});


