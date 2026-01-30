import {
  bufferUntil,
  createOperator,
  createSubject,
  getIteratorMeta,
  getValueMeta,
  setIteratorMeta,
} from "@epikodelabs/streamix";

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bufferUntil", () => {
  it("flushes buffered values whenever the notifier emits", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    notifier.next();
    await waitTick();

    source.next(3);
    notifier.next();
    await waitTick();

    source.next(4);
    source.complete();
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

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source.next(1);
    source.complete();
    await waitTick();

    expect(results).toEqual([[1]]);
  });

  it("does not emit empty buffers when notifier emits with an empty buffer", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    notifier.next();
    await waitTick();

    source.next(1);
    notifier.next();
    await waitTick();

    source.complete();
    await waitTick();

    expect(results).toEqual([[1]]);
  });

  it("propagates notifier errors", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const buffered = source.pipe(bufferUntil(notifier));

    let error: any;
    (async () => {
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
    (async () => {
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

  it("attaches collapse metadata when upstream iterator has meta", async () => {
    const tagIds = createOperator<number, number>("tagIds", function (sourceIt) {
      let n = 0;
      const iterator: AsyncIterator<number> = {
        next: async () => {
          const result = await sourceIt.next();
          if (result.done) return result;

          n += 1;
          setIteratorMeta(iterator as any, { valueId: `id${n}` }, 0, "tagIds");
          return result;
        },
      };
      return iterator;
    });

    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const buffered = source.pipe(tagIds, bufferUntil(notifier));

    const it = buffered[Symbol.asyncIterator]();

    source.next(1);
    source.next(2);
    // `bufferUntil` consumes the source on an async loop. If we trigger the notifier
    // immediately, the flush can happen before both source values have been pulled
    // into the internal buffer (depending on scheduling/backpressure).
    await waitTick();
    notifier.next();
    await waitTick();

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([1, 2]);

    expect(getIteratorMeta(it as any)).toEqual(
      jasmine.objectContaining({
        valueId: "id2",
        kind: "collapse",
        inputValueIds: ["id1", "id2"],
      })
    );

    expect(getValueMeta(r1.value)).toEqual(
      jasmine.objectContaining({
        valueId: "id2",
        kind: "collapse",
        inputValueIds: ["id1", "id2"],
      })
    );
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
