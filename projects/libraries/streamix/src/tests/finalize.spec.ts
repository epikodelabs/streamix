import { createStream, finalize, from, interval, map, pipe, iterate } from "@epikodelabs/streamix";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("finalize", () => {
  it("should call finalizer on normal completion", async () => {
    const called: string[] = [];
    const atom = pipe(from([1, 2, 3]), finalize(() => { called.push("finalized"); }));

    const values: number[] = [];
    for await (const value of iterate(atom)) {
      values.push(value);
    }

    expect(values).toEqual([1, 2, 3]);
    expect(called).toEqual(["finalized"]);
  });

  it("should call finalizer if source errors", async () => {
    const called: string[] = [];
    const error = new Error("source error");
    const atom = pipe(
      from([1]),
      map(() => { throw error; }),
      finalize(() => { called.push("finalized"); })
    );

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        // consume
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBe(error);
    expect(called).toEqual(["finalized"]);
  });

  it("should support async finalizer", async () => {
    let finalized = false;
    const atom = pipe(from([1, 2]), finalize(async () => {
      await wait(10);
      finalized = true;
    }));

    const values: number[] = [];
    for await (const value of iterate(atom)) {
      values.push(value);
    }

    expect(values).toEqual([1, 2]);
    expect(finalized).toBe(true);
  });

  it("should call finalizer once when subscription is unsubscribed", async () => {
    const finalizers: string[] = [];
    const atom = pipe(
      interval(10),
      finalize(() => { finalizers.push("finalized"); })
    );

    const values: number[] = [];
    const subscription = atom.subscribe(v => values.push(v));

    await wait(30);
    subscription.unsubscribe();
    await wait(10);

    expect(finalizers).toEqual(["finalized"]);
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
      await wait(10);
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
      await wait(10);
      finalizers.push("finalized");
      resolveFinalize();
    }).apply(sourceIterator);

    await expectAsync(iterator.throw?.(new Error("stop"))).toBeRejectedWithError("stop");
    await finalizePromise;
    expect(finalizers).toEqual(["finalized"]);
  });

  it("should keep source errors even when finalizer throws", async () => {
    const error = new Error("source error");
    const atom = pipe(
      createStream("test", async function* () { throw error; }),
      finalize(() => { throw new Error("finalizer error"); })
    );

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        // consume
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message).toBe("source error");
  });
});
