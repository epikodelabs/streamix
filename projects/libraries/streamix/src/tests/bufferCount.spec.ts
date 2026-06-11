import {
  bufferCount,
  atom,
  fromAtom,
  type Atom,
  type Stream,
} from "@epikodelabs/streamix";

describe("bufferCount", () => {
  let source: Stream<number>;
  let source$: Atom<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it("should emit buffers of the specified size", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3); // Emits [1, 2, 3]
    source$.set(4);
    source$.set(5);
    source$.set(6); // Emits [4, 5, 6]
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("should emit the remaining buffer when source completes", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose(); // Emits [1, 2]
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2]]);
  });

  it("should propagate errors from the source stream", async () => {
    const buffered = source.pipe(bufferCount(3));
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of buffered) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    source$.setError(new Error("Test error"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error.message).toBe("Test error");
  });

  it("should not emit empty buffers", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.dispose(); // Should not emit anything
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([]);
  });

  it("should respect promised buffer sizes", async () => {
    let resolveSize!: (value: number) => void;
    const promisedSize = new Promise<number>((resolve) => {
      resolveSize = resolve;
    });

    const buffered = source.pipe(bufferCount(promisedSize));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    await new Promise<void>((resolve) => setTimeout(() => (resolveSize(2), resolve()), 0));
    
    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.set(4);
    source$.dispose();

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2], [3, 4]]);
  });

  it("should behave like identity wrapped in arrays for buffer count 1", async () => {
    const buffered = source.pipe(bufferCount(1));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1], [2]]);
  });

  it("should fail gracefully if bufferSize promise rejects", async () => {
     const errorMsg = "invalid size";
     const buffered = source.pipe(bufferCount(Promise.reject(new Error(errorMsg))));
     let capturedError;
 
     try {
       // We need to trigger the loop
       const it = buffered[Symbol.asyncIterator]();
       await it.next();
     } catch (e) {
       capturedError = e;
     }
 
     expect(capturedError).toBeDefined();
     expect((capturedError as any).message).toBe(errorMsg);
   });

  it("should handle error in the middle of buffering without emitting partial buffer", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];
    let error: any = null;

    void (async () => {
      try {
        for await (const value of buffered) {
          results.push(value);
        }
      } catch (err) {
        error = err;
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.setError(new Error("Error during buffering"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([]);
    expect(error.message).toBe("Error during buffering");
  });

  it("should work with different data types", async () => {
    const objectSource$ = atom<{ id: number; name: string }>();
    const objectSubject = fromAtom(objectSource$);
    const buffered = objectSubject.pipe(bufferCount(2));
    const results: { id: number; name: string }[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    objectSource$.set({ id: 1, name: "Alice" });
    objectSource$.set({ id: 2, name: "Bob" });
    objectSource$.set({ id: 3, name: "Charlie" });
    objectSource$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([
      [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      [{ id: 3, name: "Charlie" }]
    ]);
  });

  it("should handle null and undefined values in buffers", async () => {
    const nullableSource$ = atom<number | null | undefined>();
    const nullableSubject = fromAtom(nullableSource$);
    const buffered = nullableSubject.pipe(bufferCount(3));
    const results: (number | null | undefined)[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    nullableSource$.set(1);
    nullableSource$.set(null);
    nullableSource$.set(undefined);
    nullableSource$.set(2);
    nullableSource$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, null, undefined], [2]]);
  });

  it("should handle fractional buffer sizes", async () => {
    const buffered = source.pipe(bufferCount(2.7));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.set(4);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2, 3], [4]]);
  });

  it("should handle completion immediately after creating buffer full", async () => {
    const buffered = source.pipe(bufferCount(2));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2], [3]]);
  });

  it("should emit multiple complete buffers followed by partial on completion", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    for (let i = 1; i <= 8; i++) {
      source$.set(i);
    }
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2, 3], [4, 5, 6], [7, 8]]);
  });

  it("should call next multiple times after source completes", async () => {
    const buffered = source.pipe(bufferCount(2));
    const it = buffered[Symbol.asyncIterator]();

    source$.set(1);
    source$.set(2);
    source$.dispose();

    const result1 = await it.next();
    expect(result1.done).toBe(false);
    expect(result1.value).toEqual([1, 2]);

    const result2 = await it.next();
    expect(result2.done).toBe(true);

    const result3 = await it.next();
    expect(result3.done).toBe(true);
  });

});


