import {
  bufferUntil,
  createSubject,
} from "@epikodelabs/streamix";

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bufferUntil", () => {
  it("flushes buffered values whenever the notifier emits", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();
    
    source.next(1);
    source.next(2);
    notifier.next();

    source.next(3);
    notifier.next();

    source.next(4);
    source.complete();

    // allow async drains to run before assertions
    await waitTick();

    expect(results.length).toBe(3);
    expect(results[0]).toEqual([1, 2]);
    expect(results[1]).toEqual([3]);
    expect(results[2]).toEqual([4]);
  });

  it("does emit the final buffer", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source.next(1);
    source.complete();

    // allow async drains to run before assertions
    await waitTick();

    expect(results).toEqual([[1]]);
  });

  it("does not emit empty buffers when notifier emits with an empty buffer", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    notifier.next();

    source.next(1);
    notifier.next();

    source.complete();

    // allow async drains to run before assertions
    await waitTick();

    expect(results).toEqual([[1]]);
  });

  it("propagates notifier errors", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const buffered = source.pipe(bufferUntil(notifier));

    let error: any;
    void (async () => {
      try {
        for await (const _ of buffered) {
          void _;
        }
      } catch (e) {
        error = e;
      }
    })();

    notifier.error(new Error("NOTIFIER"));
    await waitTick();

    expect(error).toEqual(jasmine.any(Error));
    expect((error as Error).message).toBe("NOTIFIER");
  });

  it("propagates source errors and cancels the notifier iterator", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();

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

    const buffered = source.pipe(bufferUntil(notifier));

    let error: any;
    void (async () => {
      try {
        for await (const _ of buffered) {
          void _;
        }
      } catch (e) {
        error = e;
      }
    })();

    source.error(new Error("SOURCE"));
    await waitTick();

    expect(error).toEqual(jasmine.any(Error));
    expect((error as Error).message).toBe("SOURCE");
    expect(returnCalls).toBeGreaterThanOrEqual(1);
  });

  it("cancels source and notifier iterators when downstream returns", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();

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

    const buffered = source.pipe(bufferUntil(notifier));
    const it = buffered[Symbol.asyncIterator]();

    source.next(1);
    notifier.next();
    await waitTick();

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([1]);

    await it.return?.();

    expect(sourceReturnCalls).toBeGreaterThanOrEqual(1);
    expect(notifierReturnCalls).toBeGreaterThanOrEqual(1);
  });
});
