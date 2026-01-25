import { bufferWhile, createSubject } from "@epikodelabs/streamix";

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bufferWhile", () => {
  it("flushes the buffer when the predicate resolves truthy", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile((buffer) => buffer.length < 3));

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    await waitTick();

    subject.next(4);
    subject.next(5);
    subject.complete();
    await waitTick();

    expect(results).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("emits the trailing buffer when the source completes", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile(() => false));

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(9);
    subject.complete();
    await waitTick();

    expect(results).toEqual([[9]]);
  });

  it("supports index parameter in predicate", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const indices: number[] = [];
    const buffered = subject.pipe(
      bufferWhile((buffer, next, index) => {
        indices.push(index);
        return buffer.length < 3; // Flush when buffer size reaches 3
      })
    );

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(10);
    subject.next(20);
    subject.next(30);
    await waitTick();

    subject.next(40);
    subject.complete();
    await waitTick();

    expect(results).toEqual([[10, 20, 30], [40]]);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("uses index to flush based on value position", async () => {
    const subject = createSubject<string>();
    const results: string[][] = [];
    const buffered = subject.pipe(
      bufferWhile((_, __, index) => index < 2) // Flush after 2 values
    );

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next("a");
    subject.next("b");
    await waitTick();

    subject.next("c");
    subject.complete();
    await waitTick();

    expect(results).toEqual([["a", "b"], ["c"]]);
  });
});
