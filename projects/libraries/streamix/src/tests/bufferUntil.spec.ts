import {
  bufferUntil,
  createOperator,
  createSubject,
  getIteratorEmissionStamp,
  getIteratorMeta,
  getValueMeta,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  setIteratorMeta
} from "@epikodelabs/streamix";

describe("bufferUntil", () => {
  it("flushes buffered values whenever the notifier emits", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const buffered = source.pipe(bufferUntil(notifier));
    const it = buffered[Symbol.asyncIterator]();
    await new Promise(resolve => setTimeout(resolve, 0)); // Allow async loops to start pulling

    source.next(1);
    source.next(2);
    notifier.next();
    expect((await it.next()).value).toEqual([1, 2]);

    source.next(3);
    notifier.next();
    expect((await it.next()).value).toEqual([3]);

    source.next(4);
    source.complete();
    expect((await it.next()).value).toEqual([4]);
    expect((await it.next()).done).toBe(true);
  });

  it("does emit the final buffer", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const buffered = source.pipe(bufferUntil(notifier));
    const it = buffered[Symbol.asyncIterator]();
    await new Promise(resolve => setTimeout(resolve, 0)); // Allow async loops to start pulling

    source.next(1);
    source.complete();

    expect((await it.next()).value).toEqual([1]);
    expect((await it.next()).done).toBe(true);
  });

  it("does not emit empty buffers when notifier emits with an empty buffer", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const buffered = source.pipe(bufferUntil(notifier));
    const it = buffered[Symbol.asyncIterator]();
    await new Promise(resolve => setTimeout(resolve, 0)); // Allow async loops to start pulling

    notifier.next();

    source.next(1);
    notifier.next();

    expect((await it.next()).value).toEqual([1]);

    source.complete();
    expect((await it.next()).done).toBe(true);
  });

  it("propagates notifier errors", async () => {
    const source = createSubject<number>();
    const notifier = createSubject<void>();
    const buffered = source.pipe(bufferUntil(notifier));
    const it = buffered[Symbol.asyncIterator]();

    notifier.error(new Error("NOTIFIER"));

    try {
      await it.next();
      fail("Should have thrown");
    } catch (e) {
      expect(e).toEqual(jasmine.any(Error));
      expect((e as Error).message).toBe("NOTIFIER");
    }
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
    const it = buffered[Symbol.asyncIterator]();

    source.error(new Error("SOURCE"));

    try {
      await it.next();
      fail("Should have thrown");
    } catch (e) {
      expect(e).toEqual(jasmine.any(Error));
      expect((e as Error).message).toBe("SOURCE");
    }
    // With strict loop, cancellation might happen in microtask cleanup, so yield once
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
          // IMPORTANT: propagate the source emission stamp through this wrapper
          // so downstream operators (like bufferUntil) can order notifier/source
          // events deterministically.
          setIteratorEmissionStamp(
            iterator as any,
            getIteratorEmissionStamp(sourceIt as any) ?? nextEmissionStamp()
          );
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
    notifier.next();

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
    await new Promise(resolve => setTimeout(resolve, 0)); // Allow async loops to start pulling

    source.next(1);
    notifier.next();

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([1]);

    await it.return?.();

    expect(sourceReturnCalls).toBeGreaterThanOrEqual(1);
    expect(notifierReturnCalls).toBeGreaterThanOrEqual(1);
  });
});
