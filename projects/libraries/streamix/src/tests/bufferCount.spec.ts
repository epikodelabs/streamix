import {atom, bufferCount, iterate, pipe, type Atom} from '@epikodelabs/streamix';

const waitTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("bufferCount", () => {
  let source: Atom<any>;

  beforeEach(() => {
    source = atom<number>();
  });

  it("should emit buffers of the specified size", async () => {
    const buffered = pipe(source, bufferCount(3));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3); // Emits [1, 2, 3]
    source.next(4);
    source.next(5);
    source.next(6); // Emits [4, 5, 6]
    source.dispose();
    await waitTick();

    await completed;
    expect(results).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("should emit the remaining buffer when source completes", async () => {
    const buffered = pipe(source, bufferCount(3));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.dispose(); // Emits [1, 2]
    await waitTick();

    await completed;
    expect(results).toEqual([[1, 2]]);
  });

  it("should propagate errors from the source stream", async () => {
    const buffered = pipe(source, bufferCount(3));
    let error: any = null;

    const completed = (async () => {
      try {
        for await (const _ of iterate(buffered)) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    source.error(new Error("Test error"));
    await waitTick();

    await completed;
    expect(error.message).toBe("Test error");
  });

  it("should not emit empty buffers", async () => {
    const buffered = pipe(source, bufferCount(3));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.dispose(); // Should not emit anything
    await waitTick();

    await completed;
    expect(results).toEqual([]);
  });

  it("should respect promised buffer sizes", async () => {
    let resolveSize!: (value: number) => void;
    const promisedSize = new Promise<number>((resolve) => {
      resolveSize = resolve;
    });

    const buffered = pipe(source, bufferCount(promisedSize));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    await new Promise<void>((resolve) => setTimeout(() => (resolveSize(2), resolve()), 0));

    source.next(1);
    source.next(2);
    source.next(3);
    source.next(4);
    source.dispose();

    await waitTick();

    await completed;
    expect(results).toEqual([[1, 2], [3, 4]]);
  });

  it("should behave like identity wrapped in arrays for buffer count 1", async () => {
    const buffered = pipe(source, bufferCount(1));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.dispose();
    await waitTick();

    await completed;
    expect(results).toEqual([[1], [2]]);
  });

  it("should fail gracefully if bufferSize promise rejects", async () => {
    const errorMsg = "invalid size";
    const buffered = pipe(source, bufferCount(Promise.reject(new Error(errorMsg))));
    let capturedError;

    try {
      const it = iterate(buffered)[Symbol.asyncIterator]();
      await it.next();
    } catch (e) {
      capturedError = e;
    }

    expect(capturedError).toBeDefined();
    expect((capturedError as any).message).toBe(errorMsg);
  });

  it("should handle error in the middle of buffering without emitting partial buffer", async () => {
    const buffered = pipe(source, bufferCount(3));
    const results: number[][] = [];
    let error: any = null;

    const completed = (async () => {
      try {
        for await (const value of iterate(buffered)) {
          results.push(value);
        }
      } catch (err) {
        error = err;
      }
    })();

    source.next(1);
    source.next(2);
    source.error(new Error("Error during buffering"));
    await waitTick();

    await completed;
    expect(results).toEqual([]);
    expect(error.message).toBe("Error during buffering");
  });

  it("should work with different data types", async () => {
    const objectSubject: Atom = atom<any>();
    const buffered = pipe(objectSubject, bufferCount(2));
    const results: { id: number; name: string }[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    objectSubject.next({ id: 1, name: "Alice" });
    objectSubject.next({ id: 2, name: "Bob" });
    objectSubject.next({ id: 3, name: "Charlie" });
    objectSubject.dispose();
    await waitTick();

    await completed;
    expect(results).toEqual([
      [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      [{ id: 3, name: "Charlie" }]
    ]);
  });

  it("should handle null and undefined values in buffers", async () => {
    const nullableSubject: Atom = atom<any>();
    const buffered = pipe(nullableSubject, bufferCount(3));
    const results: (number | null | undefined)[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    nullableSubject.next(1);
    nullableSubject.next(null);
    nullableSubject.next(undefined);
    nullableSubject.next(2);
    nullableSubject.dispose();
    await waitTick();

    await completed;
    expect(results).toEqual([[1, null, undefined], [2]]);
  });

  it("should handle fractional buffer sizes", async () => {
    const buffered = pipe(source, bufferCount(2.7));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    source.next(4);
    source.dispose();
    await waitTick();

    await completed;
    expect(results).toEqual([[1, 2, 3], [4]]);
  });

  it("should handle completion immediately after creating buffer full", async () => {
    const buffered = pipe(source, bufferCount(2));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    source.dispose();
    await waitTick();

    await completed;
    expect(results).toEqual([[1, 2], [3]]);
  });

  it("should emit multiple complete buffers followed by partial on completion", async () => {
    const buffered = pipe(source, bufferCount(3));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    for (let i = 1; i <= 8; i++) {
      source.next(i);
    }
    source.dispose();
    await waitTick();

    await completed;
    expect(results).toEqual([[1, 2, 3], [4, 5, 6], [7, 8]]);
  });

  it("should call next multiple times after source completes", async () => {
    const buffered = pipe(source, bufferCount(2));
    const it = iterate(buffered)[Symbol.asyncIterator]();

    const first = it.next();

    source.next(1);
    source.next(2);
    source.dispose();

    const result1 = await first;
    expect(result1.done).toBe(false);
    expect(result1.value).toEqual([1, 2]);

    const result2 = await it.next();
    expect(result2.done).toBe(true);

    const result3 = await it.next();
    expect(result3.done).toBe(true);
  });
});
