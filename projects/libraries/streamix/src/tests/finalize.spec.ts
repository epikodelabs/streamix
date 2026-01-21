import { createStream, finalize } from "@epikodelabs/streamix";

describe("finalize", () => {

  it("should call finalizer on normal completion", (done) => {
    const called: string[] = [];
    const stream = createStream("test", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    const finalStream = stream.pipe(finalize(() => { called.push("finalized"); }));

    const values: number[] = [];
    finalStream.subscribe({
      next: (v: number) => values.push(v),
      complete: () => {
        expect(values).toEqual([1, 2, 3]);
        expect(called).toEqual(["finalized"]);
        done();
      }
    });
  });

  it("should call finalizer if source throws", (done) => {
    const called: string[] = [];
    const stream = createStream("test", async function* () {
      yield 1;
      throw new Error("source error");
    });

    const finalStream = stream.pipe(finalize(() => { called.push("finalized"); }));

    finalStream.subscribe({
      next: () => {},
      error: (err: any) => {
        expect(err.message).toBe("source error");
        expect(called).toEqual(["finalized"]);
        done();
      }
    });
  });

  it("should only call finalizer once even if multiple subscriptions end", (done) => {
    const called: number[] = [];
    const stream = createStream("test", async function* () {
      yield 1;
    });

    const finalStream = stream.pipe(finalize(() => { called.push(1); }));

    // First subscription
    finalStream.subscribe({
      next: () => {},
      complete: () => {
        // Second subscription
        finalStream.subscribe({
          next: () => {},
          complete: () => {
            expect(called).toEqual([1]);
            done();
          }
        });
      }
    });
  });

  it("should support async finalizer", (done) => {
    let finalized = false;
    const stream = createStream("test", async function* () {
      yield 1;
      yield 2;
    });

    const finalStream = stream.pipe(finalize(async () => {
      await new Promise(r => setTimeout(r, 50));
      finalized = true;
    }));

    const values: number[] = [];
    finalStream.subscribe({
      next: (v: number) => values.push(v),
      complete: () => {
        expect(values).toEqual([1, 2]);
        expect(finalized).toBe(true);
        done();
      }
    });
  });

  it("should call finalizer once when subscription is unsubscribed", (done) => {
    const finalizers: string[] = [];
    let finalizeResolver!: () => void;
    const finalizePromise = new Promise<void>((resolve) => {
      finalizeResolver = resolve;
    });

    const stream = createStream("test", async function* (signal) {
      let counter = 0;
      while (!signal?.aborted) {
        yield counter++;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    const finalStream = stream.pipe(finalize(() => {
      finalizers.push("finalized");
      finalizeResolver();
    }));

    let subscription!: ReturnType<typeof finalStream.subscribe>;

    subscription = finalStream.subscribe({
      next: () => {
        subscription.unsubscribe();
        subscription.unsubscribe();
      },
      error: (err: any) => fail(err)
    });

    finalizePromise.then(() => {
      expect(finalizers).toEqual(["finalized"]);
      done();
    });
  });

  it("should await finalizer when iterator.return is used", async () => {
    const finalizers: string[] = [];
    let resolveFinalize!: () => void;
    const finalizePromise = new Promise<void>((resolve) => {
      resolveFinalize = resolve;
    });

    const sourceIterator = (async function* () {
      yield 1;
      yield 2;
    })() as AsyncIterator<void>;

    const iterator = finalize(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finalizers.push("finalized");
      resolveFinalize();
    }).apply(sourceIterator);

    await iterator.next();
    await iterator.return?.();
    await finalizePromise;
    expect(finalizers).toEqual(["finalized"]);
  });

  it("should await finalizer when iterator.throw is used", async () => {
    const finalizers: string[] = [];
    let resolveFinalize!: () => void;
    const finalizePromise = new Promise<void>((resolve) => {
      resolveFinalize = resolve;
    });

    const sourceIterator = (async function* () {
      yield 1;
    })() as AsyncIterator<void>;

    const iterator = finalize(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finalizers.push("finalized");
      resolveFinalize();
    }).apply(sourceIterator);

    await expectAsync(iterator.throw?.(new Error("stop"))).toBeRejectedWithError("stop");
    await finalizePromise;
    expect(finalizers).toEqual(["finalized"]);
  });

  it("should call finalizer once across sequential subscriptions", (done) => {
    const finalizers: string[] = [];
    let resolveFirst!: () => void;
    const firstFinalized = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const stream = createStream("test", async function* (signal) {
      let counter = 0;
      while (!signal?.aborted) {
        yield counter++;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    const finalStream = stream.pipe(finalize(() => {
      finalizers.push("finalized");
      resolveFirst();
    }));

    let firstSubscription!: ReturnType<typeof finalStream.subscribe>;
    firstSubscription = finalStream.subscribe({
      next: () => {
        firstSubscription.unsubscribe();
      },
      error: (err) => fail(err)
    });

    firstFinalized.then(() => {
      finalStream.subscribe({
        complete: () => {
          expect(finalizers).toEqual(["finalized"]);
          done();
        },
        error: (err) => fail(err)
      });
    });
  });

  it("should keep source errors even when finalizer throws", (done) => {
    const stream = createStream("test", async function* () {
      throw new Error("source error");
    });

    const finalStream = stream.pipe(finalize(() => {
      throw new Error("finalizer error");
    }));

    finalStream.subscribe({
      next: () => {},
      error: (err: Error) => {
        expect(err.message).toBe("source error");
        done();
      }
    });
  });
});
