import { createSubject, forkJoin, from, iterate } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('forkJoin', () => {
  it('should emit last values from all sources', async () => {
    const results: any[] = [];

    forkJoin(from([1, 2, 3]), from(['a', 'b']), from([true, false, true])).subscribe(v => { if (v !== undefined) results.push(v); });
    await delay();

    expect(results).toEqual([[3, 'b', true]]);
  });

  it('should error when a source completes without emission', async () => {
    let caught: any;

    try {
      for await (const v of iterate(forkJoin(from([] as number[]), from([1])))) {
        fail(`unexpected value ${v}`);
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
  });

  it('should accept array of streams', async () => {
    const a$ = createSubject<number>();
    const b$ = createSubject<string>();

    const results: any[] = [];
    forkJoin(a$, b$).subscribe(v => { if (v !== undefined) results.push(v); });

    a$.next(10);
    b$.next('x');
    a$.next(20);
    b$.next('y');
    a$.complete();
    b$.complete();

    await delay();

    expect(results).toEqual([[20, 'y']]);
  });

  it('should accept a single stream argument', async () => {
    const results: any[] = [];

    forkJoin(from([1, 2, 3])).subscribe(v => { if (v !== undefined) results.push(v); });
    await delay();

    expect(results).toEqual([[3]]);
  });

  it('should accept a single array argument containing streams', async () => {
    const results: any[] = [];

    forkJoin([from([1, 2]), from(['a']), from([true, false])]).subscribe(v => { if (v !== undefined) results.push(v); });
    await delay();

    expect(results).toEqual([[2, 'a', false]]);
  });

  it('should accept streams inside an array as promises', async () => {
    const results: any[] = [];

    forkJoin([Promise.resolve(from([1])), Promise.resolve(from(['x']))]).subscribe(v => { if (v !== undefined) results.push(v); });
    await delay();

    expect(results).toEqual([[1, 'x']]);
  });
});
