import {
  createOperator,
  createStream,
  createSubject,
  from,
  getIteratorMeta,
  getValueMeta,
  setIteratorMeta,
  withLatestFrom,
} from '@epikodelabs/streamix';

const scheduler = {
  flush: () => new Promise(resolve => setTimeout(resolve, 0))
};

describe('withLatestFrom', () => {
  it('should handle cancellation of the main stream', (done) => {
    const mainStream = from([1, 2, 3]);
    const otherStream = from(['A', 'B', 'C']);

    const combinedStream = mainStream.pipe(withLatestFrom(otherStream));

    let results: any[] = [];

    const subscription = combinedStream.subscribe({
      next: (value) => results.push(value),
      error: done.fail,
      complete: () => {
        expect(results).toEqual([]);
        done();
      },
    });

    subscription.unsubscribe();
  });

  it('should combine emissions with latest value from other stream', (done) => {
    const mainStream = from([1, 2, 3]);
    const otherStream = from(['A', 'B', 'C', 'D', 'E']);

    const combinedStream = mainStream.pipe(withLatestFrom(otherStream));

    let results: any[] = [];

    combinedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([
          [1, jasmine.any(String)],
          [2, jasmine.any(String)],
          [3, jasmine.any(String)],
        ]);

        expect(['A', 'B', 'C', 'D', 'E']).toContain(results[0][1]);
        expect(['A', 'B', 'C', 'D', 'E']).toContain(results[1][1]);
        expect(['A', 'B', 'C', 'D', 'E']).toContain(results[2][1]);
        done();
      },
      error: done.fail,
    });
  });

  it('should handle cases where other stream contains one value', (done) => {
    const mainStream = from([1, 2, 3]);
    const otherStream = from(['A']);

    const combinedStream = mainStream.pipe(withLatestFrom(otherStream));

    let results: any[] = [];

    combinedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([
          [1, 'A'],
          [2, 'A'],
          [3, 'A'],
        ]);
        done();
      },
      error: done.fail,
    });
  });

  it('should support passing streams as a single array argument', (done) => {
    const mainStream = from([1, 2, 3]);
    const otherStream = from(['A', 'B', 'C']);

    const combinedStream = mainStream.pipe(withLatestFrom([otherStream]));
    const results: any[] = [];

    combinedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results.length).toBe(3);
        results.forEach((tuple) => {
          expect(tuple[0]).toEqual(jasmine.any(Number));
          expect(tuple[1]).toEqual(jasmine.any(String));
        });
        done();
      },
      error: done.fail,
    });
  });

  it('should support promise-wrapped auxiliary streams', async () => {
    const mainStream = from([1, 2]);
    const otherStream = Promise.resolve(from(['Z']));

    const combinedStream = mainStream.pipe(withLatestFrom(otherStream));
    const results: any[] = [];

    await new Promise<void>((resolve, reject) => {
      combinedStream.subscribe({
        next: (value) => results.push(value),
        complete: resolve,
        error: reject,
      });
    });

    expect(results).toEqual([
      [1, 'Z'],
      [2, 'Z'],
    ]);
  });

  it('should emit nothing when called with no auxiliary streams', async () => {
    const mainStream = from([1, 2, 3]);
    const combinedStream = mainStream.pipe(withLatestFrom());
    const results: any[] = [];

    await new Promise<void>((resolve, reject) => {
      combinedStream.subscribe({
        next: (value) => results.push(value),
        complete: resolve,
        error: reject,
      });
    });

    expect(results).toEqual([]);
  });

  it('should propagate errors from auxiliary streams', async () => {
    const mainStream = from([1]);
    const errorStream = createStream('auxError', async function* () {
      throw new Error('AUX');
    });

    const combinedStream = mainStream.pipe(withLatestFrom(errorStream));

    await new Promise<void>((resolve) => {
      let sawError = false;
      combinedStream.subscribe({
        next: () => fail('Expected no values'),
        complete: () => {
          if (!sawError) fail('Expected error');
        },
        error: (err) => {
          sawError = true;
          expect(err).toEqual(jasmine.any(Error));
          expect((err as Error).message).toBe('AUX');
          resolve();
        },
      });
    });
  });

  it('should convert non-Error auxiliary errors into Error', async () => {
    const main$ = createSubject<number>();
    const aux$ = createSubject<string>();

    const combined = main$.pipe(withLatestFrom(aux$));

    const done = new Promise<void>((resolve) => {
      let sawError = false;
      combined.subscribe({
        next: () => fail("Expected no values"),
        complete: () => {
          if (!sawError) fail("Expected error");
        },
        error: (err) => {
          sawError = true;
          expect(err).toEqual(jasmine.any(Error));
          expect((err as Error).message).toBe("AUX_STR");
          resolve();
        },
      });
    });

    await scheduler.flush();
    aux$.error("AUX_STR");
    await scheduler.flush();
    await done;
  });

  it('should convert non-Error source errors into Error', async () => {
    const main$ = createSubject<number>();
    const aux$ = createSubject<string>();

    const combined = main$.pipe(withLatestFrom(aux$));

    const done = new Promise<void>((resolve) => {
      let sawError = false;
      combined.subscribe({
        next: () => fail("Expected no values"),
        complete: () => {
          if (!sawError) fail("Expected error");
        },
        error: (err) => {
          sawError = true;
          expect(err).toEqual(jasmine.any(Error));
          expect((err as Error).message).toBe("MAIN_STR");
          resolve();
        },
      });
    });

    await scheduler.flush();
    aux$.next("A");
    await scheduler.flush();
    main$.error("MAIN_STR");
    await scheduler.flush();
    await done;
  });

  it('unsubscribe does not re-abort after the pipeline is already aborted', async () => {
    const main$ = createSubject<number>();
    const aux$ = createSubject<string>();

    const combined = main$.pipe(withLatestFrom(aux$));

    let subscription: any;

    const done = new Promise<void>((resolve) => {
      let sawError = false;
      subscription = combined.subscribe({
        next: () => fail("Expected no values"),
        complete: () => {
          if (!sawError) fail("Expected error");
        },
        error: () => {
          sawError = true;
          resolve();
        },
      });
    });

    await scheduler.flush();
    aux$.error(new Error("AUX"));
    await scheduler.flush();
    await done;

    subscription.unsubscribe();
    await scheduler.flush();
  });

  it('auxiliary errors after abort are ignored', async () => {
    const main$ = createSubject<number>();
    const aux1$ = createSubject<string>();
    const aux2$ = createSubject<string>();

    const combined = main$.pipe(withLatestFrom(aux1$, aux2$));

    const errorSpy = jasmine.createSpy("errorSpy");
    combined.subscribe({ next: (value) => console.log(value), error: errorSpy });

    aux1$.error(new Error("FIRST"));
    aux2$.error("SECOND");
    await new Promise((r) => setTimeout(r, 0));

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('abortPromise resolves immediately when already aborted before setup completes', async () => {
    const main$ = from([1, 2, 3]);

    let resolveAux!: (s: any) => void;
    const auxPromise = new Promise<any>((resolve) => {
      resolveAux = resolve;
    });

    const combined = main$.pipe(withLatestFrom(auxPromise));

    const errorSpy = jasmine.createSpy("errorSpy");
    const completeSpy = jasmine.createSpy("completeSpy");

    const sub = combined.subscribe({
      next: () => fail("Expected no values"),
      error: errorSpy,
      complete: completeSpy,
    });

    sub.unsubscribe();
    resolveAux(from(["A"]));

    await new Promise((r) => setTimeout(r, 0));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not emit until all auxiliary streams have a value', async () => {
    const main$ = createSubject<number>();
    const aux$ = createSubject<string>();
    const combined = main$.pipe(withLatestFrom(aux$));

    const results: any[] = [];
    combined.subscribe({ next: (v) => results.push(v) });

    await scheduler.flush();

    // Main emits before aux has any value -> gated, no emission.
    main$.next(1);
    await scheduler.flush();
    expect(results).toEqual([]);

    aux$.next('A');
    await scheduler.flush();

    main$.next(2);
    await scheduler.flush();

    expect(results).toEqual([[2, 'A']]);
  });

  it('supports auxiliary inputs that are plain values and promises', async () => {
    const mainStream = from([1, 2]);
    const combined = mainStream.pipe(withLatestFrom(100 as any, Promise.resolve('X') as any));

    const results: any[] = [];
    await new Promise<void>((resolve, reject) => {
      combined.subscribe({
        next: (v) => results.push(v),
        complete: resolve,
        error: reject,
      });
    });

    expect(results).toEqual([
      [1, 100, 'X'],
      [2, 100, 'X'],
    ]);
  });

  it('attaches iterator/value metadata from the source emission', async () => {
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

    const main$ = createSubject<number>();
    const aux$ = createSubject<string>();

    const combined = main$.pipe(tagIds, withLatestFrom(aux$));
    const it = combined[Symbol.asyncIterator]();

    aux$.next('A');
    await scheduler.flush();

    main$.next(5);
    await scheduler.flush();

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([5, 'A']);

    expect(getIteratorMeta(it as any)).toEqual(
      jasmine.objectContaining({ valueId: 'id1' })
    );

    expect(getValueMeta(r1.value)).toEqual(
      jasmine.objectContaining({ valueId: 'id1' })
    );
  });
});


