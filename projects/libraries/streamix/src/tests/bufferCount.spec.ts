import {
  bufferCount,
  createOperator,
  createSubject,
  getIteratorMeta,
  getValueMeta,
  setIteratorMeta,
  type Stream,
} from "@epikodelabs/streamix";

describe("bufferCount", () => {
  let source: Stream<number>;
  let subject: ReturnType<typeof createSubject<number>>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it("should emit buffers of the specified size", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3); // Emits [1, 2, 3]
    subject.next(4);
    subject.next(5);
    subject.next(6); // Emits [4, 5, 6]
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("should emit the remaining buffer when source completes", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.complete(); // Emits [1, 2]
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([[1, 2]]);
  });

  it("should propagate errors from the source stream", async () => {
    const buffered = source.pipe(bufferCount(3));
    let error: any = null;

    (async () => {
      try {
        for await (const _ of buffered) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.error(new Error("Test error"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error.message).toBe("Test error");
  });

  it("should not emit empty buffers", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.complete(); // Should not emit anything
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

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    await new Promise<void>((resolve) => setTimeout(() => (resolveSize(2), resolve()), 0));
    
    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.next(4);
    subject.complete();

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(results).toEqual([[1, 2], [3, 4]]);
  });

  it("should behave like identity wrapped in arrays for buffer count 1", async () => {
    const buffered = source.pipe(bufferCount(1));
    const results: number[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));

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

    (async () => {
      try {
        for await (const value of buffered) {
          results.push(value);
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.error(new Error("Error during buffering"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([]);
    expect(error.message).toBe("Error during buffering");
  });

  it("should work with different data types", async () => {
    const objectSubject = createSubject<{ id: number; name: string }>();
    const buffered = objectSubject.pipe(bufferCount(2));
    const results: { id: number; name: string }[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    objectSubject.next({ id: 1, name: "Alice" });
    objectSubject.next({ id: 2, name: "Bob" });
    objectSubject.next({ id: 3, name: "Charlie" });
    objectSubject.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(results).toEqual([
      [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      [{ id: 3, name: "Charlie" }]
    ]);
  });

  it("should handle null and undefined values in buffers", async () => {
    const nullableSubject = createSubject<number | null | undefined>();
    const buffered = nullableSubject.pipe(bufferCount(3));
    const results: (number | null | undefined)[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    nullableSubject.next(1);
    nullableSubject.next(null);
    nullableSubject.next(undefined);
    nullableSubject.next(2);
    nullableSubject.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(results).toEqual([[1, null, undefined], [2]]);
  });

  it("should handle fractional buffer sizes", async () => {
    const buffered = source.pipe(bufferCount(2.7));
    const results: number[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.next(4);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(results).toEqual([[1, 2, 3], [4]]);
  });

  it("should handle completion immediately after creating buffer full", async () => {
    const buffered = source.pipe(bufferCount(2));
    const results: number[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(results).toEqual([[1, 2], [3]]);
  });

  it("should emit multiple complete buffers followed by partial on completion", async () => {
    const buffered = source.pipe(bufferCount(3));
    const results: number[][] = [];

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    for (let i = 1; i <= 8; i++) {
      subject.next(i);
    }
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(results).toEqual([[1, 2, 3], [4, 5, 6], [7, 8]]);
  });

  it("should call next multiple times after source completes", async () => {
    const buffered = source.pipe(bufferCount(2));
    const it = buffered[Symbol.asyncIterator]();

    subject.next(1);
    subject.next(2);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result1 = await it.next();
    expect(result1.done).toBe(false);
    expect(result1.value).toEqual([1, 2]);

    const result2 = await it.next();
    expect(result2.done).toBe(true);

    const result3 = await it.next();
    expect(result3.done).toBe(true);
  });

  it("should attach collapse metadata when upstream iterator has meta (full buffers)", async () => {
    const tagIds = createOperator<number, number>("tagIds", function (source) {
      let n = 0;
      const iterator: AsyncIterator<number> = {
        next: async () => {
          const result = await source.next();
          if (result.done) return result;

          n += 1;
          setIteratorMeta(iterator as any, { valueId: `id${n}` }, 0, "tagIds");
          return result;
        },
      };
      return iterator;
    });

    const buffered = source.pipe(tagIds, bufferCount(2));
    const it = buffered[Symbol.asyncIterator]();

    subject.next(10);
    subject.next(20);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = await it.next();
    expect(result.done).toBe(false);
    expect(result.value).toEqual([10, 20]);

    const iteratorMeta = getIteratorMeta(it as any);
    expect(iteratorMeta).toEqual(
      jasmine.objectContaining({
        valueId: "id2",
        kind: "collapse",
        inputValueIds: ["id1", "id2"],
      })
    );

    const valueMeta = getValueMeta(result.value);
    expect(valueMeta).toEqual(
      jasmine.objectContaining({
        valueId: "id2",
        kind: "collapse",
        inputValueIds: ["id1", "id2"],
      })
    );

    subject.next(30);
    await new Promise((resolve) => setTimeout(resolve, 0));
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    
    const result2 = await it.next();
    expect(result2.done).toBe(false);
    expect(result2.value).toEqual([30]);
    expect(getValueMeta(result2.value)).toEqual(
      jasmine.objectContaining({
        valueId: "id3",
        kind: "collapse",
        inputValueIds: ["id3"],
      })
    );
  });

  it("should attach collapse metadata when flushing partial buffer on completion", async () => {
    const tagIds = createOperator<number, number>("tagIds", function (source) {
      let n = 0;
      const iterator: AsyncIterator<number> = {
        next: async () => {
          const result = await source.next();
          if (result.done) return result;

          n += 1;
          setIteratorMeta(iterator as any, { valueId: `id${n}` }, 0, "tagIds");
          return result;
        },
      };
      return iterator;
    });

    const buffered = source.pipe(tagIds, bufferCount(2));
    const it = buffered[Symbol.asyncIterator]();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    
    const result1 = await it.next();
    expect(result1.done).toBe(false);
    expect(result1.value).toEqual([1, 2]);
    expect(getValueMeta(result1.value)).toEqual(
      jasmine.objectContaining({
        valueId: "id2",
        kind: "collapse",
        inputValueIds: ["id1", "id2"],
      })
    );

    const result2 = await it.next();
    expect(result2.done).toBe(false);
    expect(result2.value).toEqual([3]);
    expect(getValueMeta(result2.value)).toEqual(
      jasmine.objectContaining({
        valueId: "id3",
        kind: "collapse",
        inputValueIds: ["id3"],
      })
    );

    const done = await it.next();
    expect(done.done).toBe(true);
  });
});


