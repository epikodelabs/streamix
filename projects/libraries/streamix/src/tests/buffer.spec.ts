import { buffer, createSubject, type Stream } from "@epikodelabs/streamix";

describe("buffer", () => {
  let source: Stream<number>;
  let subject: ReturnType<typeof createSubject<number>>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it("should emit buffered values at the specified interval", async () => {
    const duration = 100;
    const buffered = source.pipe(buffer(duration));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    subject.next(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    subject.next(3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    subject.next(4);
    await new Promise((resolve) => setTimeout(resolve, 100));
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([[1, 2, 3], [4]]);
  });

  it("should complete when the source completes", async () => {
    const duration = 100;
    const buffered = source.pipe(buffer(duration));
    let completed = false;

    void (async () => {
      for await (const _ of buffered) {
        void _;
      }
      completed = true;
    })();

    subject.next(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(completed).toBeTrue();
  });

  it("should emit the last buffer when the source completes", async () => {
    const duration = 100;
    const buffered = source.pipe(buffer(duration));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    subject.next(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([[1, 2]]);
  });

  it("should propagate errors from the source stream", async () => {
    const duration = 100;
    const buffered = source.pipe(buffer(duration));
    let error: any = null;
    let started = false;

    void (async () => {
      try {
        for await (const _ of buffered) {
          started = true;
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    // Wait for consumer to start
    while (!started) {
      subject.next(1); // Emit a value to start the stream
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Trigger error
    subject.error(new Error("Test error"));

    // Wait for consumer to catch error
    await new Promise((resolve) => setTimeout(resolve, 0));


    // Assert
    expect(error?.message).toBe("Test error");
  });

  it("should emit empty arrays if no values are received in the interval", async () => {
    const duration = 100;
    const buffered = source.pipe(buffer(duration));
    const results: number[][] = [];

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 100));
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([]);
  });

  it("should cleanup when iterator is closed early via return()", async () => {
    const duration = 100;
    const buffered = source.pipe(buffer(duration));
    const results: number[][] = [];
    let iteratorReturned = false;

    const iterator = buffered[Symbol.asyncIterator]();
    
    subject.next(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    const firstResult = await iterator.next();
    if (!firstResult.done) {
      results.push(firstResult.value);
    }
    
    // Call return() to cleanup early
    await iterator.return?.();
    iteratorReturned = true;
    
    // These values should not be processed
    subject.next(2);
    subject.next(3);
    await new Promise((resolve) => setTimeout(resolve, 150));
    
    const nextResult = await iterator.next();
    
    expect(iteratorReturned).toBe(true);
    expect(nextResult.done).toBe(true);
    expect(results.length).toBe(1);
  });

  it("should cleanup when iterator receives throw()", async () => {
    const duration = 100;
    const buffered = source.pipe(buffer(duration));
    let caughtError: any = null;

    const iterator = buffered[Symbol.asyncIterator]();
    
    subject.next(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    await iterator.next();
    
    // Call throw() to cleanup with error
    try {
      await iterator.throw?.(new Error("Forced error"));
    } catch (err) {
      caughtError = err;
    }
    
    expect(caughtError?.message).toBe("Forced error");
    
    // Iterator should be done
    const nextResult = await iterator.next();
    expect(nextResult.done).toBe(true);
  });
});


