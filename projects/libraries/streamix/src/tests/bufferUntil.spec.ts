import { atom, bufferUntil, from, iterate, pipe } from '@epikodelabs/streamix';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const waitTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("bufferUntil", () => {
  it("flushes buffered values whenever the notifier emits", async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const results: number[][] = [];
    const buffered = pipe(source, bufferUntil(notifier));

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    notifier.next();

    source.next(3);
    notifier.next();

    source.next(4);
    source.dispose();

    await waitTick();
    await completed;

    expect(results.length).toBe(3);
    expect(results[0]).toEqual([1, 2]);
    expect(results[1]).toEqual([3]);
    expect(results[2]).toEqual([4]);
  });

  it("does emit the final buffer", async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const results: number[][] = [];
    const buffered = pipe(source, bufferUntil(notifier));

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.dispose();

    await waitTick();
    await completed;

    expect(results).toEqual([[1]]);
  });

  it("does not emit empty buffers when notifier emits with an empty buffer", async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const results: number[][] = [];
    const buffered = pipe(source, bufferUntil(notifier));

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    notifier.next();

    source.next(1);
    notifier.next();

    source.dispose();

    await waitTick();
    await completed;

    expect(results).toEqual([[1]]);
  });

  it("propagates notifier errors", async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const buffered = pipe(source, bufferUntil(notifier));

    let error: any;
    const completed = (async () => {
      try {
        for await (const _ of iterate(buffered)) {
          void _;
        }
      } catch (e) {
        error = e;
      }
    })();

    notifier.fail(new Error("NOTIFIER"));
    await waitTick();
    await completed;

    expect(error).toEqual(jasmine.any(Error));
    expect((error as Error).message).toBe("NOTIFIER");
  });

  it("propagates source errors and cancels the notifier iterator", async () => {
    const source = atom<number>();
    const notifier = atom<void>();

    let returnCalls = 0;
    const originalAsyncIterator = (notifier as any)[Symbol.asyncIterator].bind(notifier);
    (notifier as any)[Symbol.asyncIterator] = () => {
      const it = originalAsyncIterator();
      const originalReturn = it.return?.bind(it);
      if (originalReturn) {
        it.return = (...args: any[]) => {
          returnCalls += 1;
          return originalReturn(...args);
        };
      }
      return it;
    };

    const buffered = pipe(source, bufferUntil(notifier));

    let error: any;
    const completed = (async () => {
      try {
        for await (const _ of iterate(buffered)) {
          void _;
        }
      } catch (e) {
        error = e;
      }
    })();

    source.fail(new Error("SOURCE"));
    await waitTick();
    await completed;

    expect(error).toEqual(jasmine.any(Error));
    expect((error as Error).message).toBe("SOURCE");
    expect(returnCalls).toBeGreaterThanOrEqual(1);
  });

  it("cancels source and notifier iterators when downstream returns", async () => {
    const source = atom<number>();
    const notifier = atom<void>();

    let sourceReturnCalls = 0;
    const originalSourceAsyncIterator = (source as any)[Symbol.asyncIterator].bind(source);
    (source as any)[Symbol.asyncIterator] = () => {
      const it = originalSourceAsyncIterator();
      const originalReturn = it.return?.bind(it);
      if (originalReturn) {
        it.return = (...args: any[]) => {
          sourceReturnCalls += 1;
          return originalReturn(...args);
        };
      }
      return it;
    };

    let notifierReturnCalls = 0;
    const originalNotifierAsyncIterator = (notifier as any)[Symbol.asyncIterator].bind(notifier);
    (notifier as any)[Symbol.asyncIterator] = () => {
      const it = originalNotifierAsyncIterator();
      const originalReturn = it.return?.bind(it);
      if (originalReturn) {
        it.return = (...args: any[]) => {
          notifierReturnCalls += 1;
          return originalReturn(...args);
        };
      }
      return it;
    };

    const buffered = pipe(source, bufferUntil(notifier));
    const it = iterate(buffered)[Symbol.asyncIterator]();

    await sleep(50);

    source.next(1);
    notifier.next();
    await waitTick();

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([1]);

    void it.return?.();
    await waitTick();

    expect(sourceReturnCalls).toBeGreaterThanOrEqual(1);
    expect(notifierReturnCalls).toBeGreaterThanOrEqual(1);
  });

  it("supports synchronous helper inspection and flushing", async () => {
    const iterator = bufferUntil(from([true])).apply(iterate(from([1, 2]))[Symbol.asyncIterator]()) as AsyncIterator<number[]> & {
      __tryNext?: () => IteratorResult<number[]> | null;
      __hasBufferedValues?: () => boolean;
    };

    expect(iterator.__hasBufferedValues?.()).toBeFalse();
    await waitTick();

    expect(iterator.__tryNext?.()).toEqual({ value: [1, 2], done: false });
    expect(iterator.__tryNext?.()).toEqual({ value: undefined, done: true });
    expect(iterator.__hasBufferedValues?.()).toBeTrue();
  });
});
