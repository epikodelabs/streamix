import { bufferWhile, createSubject } from "@epikodelabs/streamix";

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bufferWhile", () => {
  it("flushes the buffer when the predicate resolves truthy", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile((_, next) => next % 3 === 0));

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
});
