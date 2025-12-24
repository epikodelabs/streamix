import { createSubject, forkJoin, from } from '@epikode/streamix';

describe('forkJoin', () => {
  it('should emit last values from all sources', async () => {
    const results: any[] = [];

    await new Promise<void>((resolve, reject) => {
      forkJoin(from([1, 2, 3]), from(['a', 'b']), from([true, false, true])).subscribe({
        next: (value) => results.push(value),
        complete: resolve,
        error: reject,
      });
    });

    expect(results).toEqual([[3, 'b', true]]);
  });

  it('should error when a source completes without emission', async () => {
    let error: any;

    await new Promise<void>((resolve) => {
      forkJoin(from([] as number[]), from([1])).subscribe({
        next: () => {},
        complete: resolve,
        error: (err) => {
          error = err;
          resolve();
        },
      });
    });

    expect(error).toBeInstanceOf(Error);
  });

  it('should accept array of streams', async () => {
    const a$ = createSubject<number>();
    const b$ = createSubject<string>();

    const results: any[] = [];
    const done = new Promise<void>((resolve, reject) => {
      forkJoin(a$, b$).subscribe({
        next: (value) => results.push(value),
        complete: resolve,
        error: reject,
      });
    });

    a$.next(10);
    b$.next('x');
    a$.next(20);
    b$.next('y');
    a$.complete();
    b$.complete();

    await done;
    expect(results).toEqual([[20, 'y']]);
  });

  it('should accept a single stream argument', async () => {
    const results: any[] = [];

    await new Promise<void>((resolve, reject) => {
      forkJoin(from([1, 2, 3])).subscribe({
        next: (value) => results.push(value),
        complete: resolve,
        error: reject,
      });
    });

    expect(results).toEqual([[3]]);
  });

  it('should accept a single array argument containing streams', async () => {
    const results: any[] = [];

    await new Promise<void>((resolve, reject) => {
      forkJoin([from([1, 2]), from(['a']), from([true, false])]).subscribe({
        next: (value) => results.push(value),
        complete: resolve,
        error: reject,
      });
    });

    expect(results).toEqual([[2, 'a', false]]);
  });

  it('should accept streams inside an array as promises', async () => {
    const results: any[] = [];

    await new Promise<void>((resolve, reject) => {
      forkJoin([Promise.resolve(from([1])), Promise.resolve(from(['x']))]).subscribe({
        next: (value) => results.push(value),
        complete: resolve,
        error: reject,
      });
    });

    expect(results).toEqual([[1, 'x']]);
  });
});

