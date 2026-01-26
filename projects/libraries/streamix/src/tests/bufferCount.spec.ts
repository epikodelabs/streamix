import { bufferCount, createSubject, type Stream } from "@epikodelabs/streamix";

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
    await new Promise((resolve) => setTimeout(resolve, 100));

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
    await new Promise((resolve) => setTimeout(resolve, 100));

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
    await new Promise((resolve) => setTimeout(resolve, 100));

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
    await new Promise((resolve) => setTimeout(resolve, 100));

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
});


