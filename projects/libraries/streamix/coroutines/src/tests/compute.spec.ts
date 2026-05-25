import { from, of } from "@epikodelabs/streamix";
import { compute } from "@epikodelabs/streamix/coroutines";
import { idescribe } from "./env.spec";

idescribe("compute", () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;

  beforeAll(() => {
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;
  });

  it("should emit a single computed result", async () => {
    const worker = compute<number, number>((x: number) => x * 2);
    const stream = of(5).pipe(worker);

    const results: number[] = [];
    for await (const v of stream) {
      results.push(v);
    }

    expect(results).toEqual([10]);
  });

  it("should work with multiple compute calls using the same operator", async () => {
    const worker = compute<number, number>((x: number) => x + 1);

    const stream1 = of(1).pipe(worker);
    const stream2 = of(5).pipe(worker);

    const r1: number[] = [];
    const r2: number[] = [];

    for await (const v of stream1) r1.push(v);
    for await (const v of stream2) r2.push(v);

    expect(r1).toEqual([2]);
    expect(r2).toEqual([6]);
  });

  it("should process multiple emissions in one subscription", async () => {
    const worker = compute<number, number>((x: number) => x * x);
    const stream = from([2, 3, 4]).pipe(worker);

    const results: number[] = [];
    for await (const v of stream) {
      results.push(v);
    }

    expect(results).toEqual([4, 9, 16]);
  });

  it("should propagate errors from the coroutine task", async () => {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const worker = compute<number, number>((_x: number) => {
      throw new Error("boom");
    });
    const stream = of(99).pipe(worker);

    try {
      for await (const _ of stream) {
        // should not reach here
      }
      fail("Expected error to be thrown");
    } catch (err: any) {
      expect(err.message).toBe("boom");
    } finally {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    }
  });

  it("should await promised parameters before computing", async () => {
    const worker = compute<number, number>((x: number) => x + 7);

    let resolver: (value: number) => void;
    const promiseParam = new Promise<number>((resolve) => {
      resolver = resolve;
    });

    const stream = of(promiseParam).pipe(worker);

    const results: number[] = [];
    const iterate = (async () => {
      for await (const v of stream) {
        results.push(v);
      }
    })();

    setTimeout(() => resolver!(5), 10);
    await iterate;

    expect(results).toEqual([12]);
  });
});
