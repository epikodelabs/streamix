import { commit, createStream } from "@epikodelabs/streamix";

describe("commit", () => {
  const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  it("should discard values from a failed attempt and emit the successful retry", async () => {
    let attempt = 0;
    const factory = jasmine.createSpy("factory").and.callFake(() => {
      attempt++;
      return createStream<number>("commitSource", async function* () {
        if (attempt === 1) {
          yield 1;
          yield 2;
          throw new Error("retry me");
        }

        yield 3;
        yield 4;
      });
    });

    const values: number[] = [];
    for await (const value of commit(factory, 1, 0)) {
      values.push(value);
    }

    expect(factory).toHaveBeenCalledTimes(2);
    expect(values).toEqual([3, 4]);
  });

  it("should not emit buffered values before a delayed retry commits", async () => {
    let attempt = 0;
    let resolveDelay!: (value: number) => void;
    const delayPromise = new Promise<number>((resolve) => {
      resolveDelay = resolve;
    });

    const factory = jasmine.createSpy("factory").and.callFake(() => {
      attempt++;
      return createStream<number>("delayedCommit", async function* () {
        if (attempt === 1) {
          yield 1;
          throw new Error("fail once");
        }

        yield 2;
      });
    });

    const values: number[] = [];
    const finished = (async () => {
      for await (const value of commit(factory, 1, delayPromise)) {
        values.push(value);
      }
    })();

    await sleep(25);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(values).toEqual([]);

    resolveDelay(0);
    await finished;

    expect(factory).toHaveBeenCalledTimes(2);
    expect(values).toEqual([2]);
  });

  it("should support plain values and promised results from the factory", async () => {
    const plainValues: number[] = [];
    for await (const value of commit(() => 5, 0, 0)) {
      plainValues.push(value);
    }

    const promisedValues: number[] = [];
    for await (const value of commit(() => Promise.resolve(7), 0, 0)) {
      promisedValues.push(value);
    }

    expect(plainValues).toEqual([5]);
    expect(promisedValues).toEqual([7]);
  });

  it("should not emit a partial batch when unsubscribed mid-attempt", async () => {
    let iterationCount = 0;
    const values: number[] = [];

    const stream$ = commit(
      () =>
        createStream<number>("slowCommit", async function* (signal) {
          while (!signal?.aborted) {
            iterationCount++;
            yield iterationCount;
            await sleep(10);
          }
        }),
      0,
      0
    );

    const sub = stream$.subscribe({
      next: (value) => values.push(value),
      error: () => fail("Unexpected error"),
      complete: () => {},
    });

    await sleep(35);
    sub.unsubscribe();
    await sleep(20);

    expect(iterationCount).toBeGreaterThan(0);
    expect(values).toEqual([]);
  });
});
