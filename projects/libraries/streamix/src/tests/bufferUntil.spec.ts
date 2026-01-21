import { bufferUntil, createSubject } from "@epikodelabs/streamix";

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
});
