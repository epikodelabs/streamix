import {
  bufferUntil,
  atom,
  fromAtom,
  type Atom,
} from "@epikodelabs/streamix";

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bufferUntil", () => {
  it("flushes buffered values whenever the notifier emits", async () => {
    const source$: Atom<number> = atom<number>();
    const source = fromAtom(source$);
    const notifier$: Atom<void> = atom<void>();
    const notifier = fromAtom(notifier$);
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();
    
    source$.set(1);
    source$.set(2);
    notifier$.set(void 0);

    source$.set(3);
    notifier$.set(void 0);

    source$.set(4);
    source$.dispose();

    // allow async drains to run before assertions
    await waitTick();

    expect(results.length).toBe(3);
    expect(results[0]).toEqual([1, 2]);
    expect(results[1]).toEqual([3]);
    expect(results[2]).toEqual([4]);
  });

  it("does emit the final buffer", async () => {
    const source$: Atom<number> = atom<number>();
    const source = fromAtom(source$);
    const notifier$: Atom<void> = atom<void>();
    const notifier = fromAtom(notifier$);
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.dispose();

    // allow async drains to run before assertions
    await waitTick();

    expect(results).toEqual([[1]]);
  });

  it("does not emit empty buffers when notifier emits with an empty buffer", async () => {
    const source$: Atom<number> = atom<number>();
    const source = fromAtom(source$);
    const notifier$: Atom<void> = atom<void>();
    const notifier = fromAtom(notifier$);
    const results: number[][] = [];
    const buffered = source.pipe(bufferUntil(notifier));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    notifier$.set(void 0);

    source$.set(1);
    notifier$.set(void 0);

    source$.dispose();

    // allow async drains to run before assertions
    await waitTick();

    expect(results).toEqual([[1]]);
  });

  it("propagates notifier errors", async () => {
    const source$: Atom<number> = atom<number>();
    const source = fromAtom(source$);
    const notifier$: Atom<void> = atom<void>();
    const notifier = fromAtom(notifier$);
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

    notifier$.setError(new Error("NOTIFIER"));
    await waitTick();

    expect(error).toEqual(jasmine.any(Error));
    expect((error as Error).message).toBe("NOTIFIER");
  });

  it("propagates source errors and cancels the notifier iterator", async () => {
    const source$: Atom<number> = atom<number>();
    const source = fromAtom(source$);
    const notifier$: Atom<void> = atom<void>();
    const notifier = fromAtom(notifier$);

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

    source$.setError(new Error("SOURCE"));
    await waitTick();

    expect(error).toEqual(jasmine.any(Error));
    expect((error as Error).message).toBe("SOURCE");
    expect(returnCalls).toBeGreaterThanOrEqual(1);
  });

  it("cancels source and notifier iterators when downstream returns", async () => {
    const source$: Atom<number> = atom<number>();
    const source = fromAtom(source$);
    const notifier$: Atom<void> = atom<void>();
    const notifier = fromAtom(notifier$);

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

    source$.set(1);
    notifier$.set(void 0);
    await waitTick();

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([1]);

    await it.return?.();

    expect(sourceReturnCalls).toBeGreaterThanOrEqual(1);
    expect(notifierReturnCalls).toBeGreaterThanOrEqual(1);
  });
});
