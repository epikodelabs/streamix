import { commit, flow, iterate } from '@epikodelabs/streamix';

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("commit", () => {
  it("should discard values from a failed attempt and emit the successful retry", async () => {
    let attempt = 0;
    const factory = jasmine.createSpy("factory").and.callFake(() => {
      attempt++;
      return flow<number>(async function* () {
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
    for await (const value of iterate(commit(factory, 1, 0))) {
      if (value !== undefined) values.push(value);
    }

    expect(factory).toHaveBeenCalledTimes(2);
    expect(values).toEqual([3, 4]);
  });

  it("should not emit buffered values before a delayed retry commits", async () => {
    let attempt = 0;
    let resolveDelay!: (value: number) => void;
    const delay$ = new Promise<number>((resolve) => {
      resolveDelay = resolve;
    });

    const factory = jasmine.createSpy("factory").and.callFake(() => {
      attempt++;
      return flow<number>(async function* () {
        if (attempt === 1) {
          yield 1;
          throw new Error("fail once");
        }

        yield 2;
      });
    });

    const values: number[] = [];
    const finished = (async () => {
      for await (const value of iterate(commit(factory, 1, delay$))) {
        if (value !== undefined) values.push(value);
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
    for await (const value of iterate(commit(() => 5, 0, 0))) {
      if (value !== undefined) plainValues.push(value);
    }

    const promisedValues: number[] = [];
    for await (const value of iterate(commit(() => Promise.resolve(7), 0, 0))) {
      if (value !== undefined) promisedValues.push(value);
    }

    expect(plainValues).toEqual([5]);
    expect(promisedValues).toEqual([7]);
  });

  it("should not emit a partial batch when unsubscribed mid-attempt", async () => {
    let iterationCount = 0;
    const values: number[] = [];

    const atom = commit(
      () =>
        flow<number>(async function* (signal) {
          while (!signal?.aborted) {
            iterationCount++;
            yield iterationCount;
            await sleep(10);
          }
        }),
      0,
      0
    );

    const unsubscribe = atom.subscribe(v => { if (v !== undefined) values.push(v); });

    await sleep(35);
    unsubscribe();
    await sleep(20);

    expect(iterationCount).toBeGreaterThan(0);
    expect(values).toEqual([]);
  });
});
