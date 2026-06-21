import { atom, buffer, iterate, pipe, type Writable } from '@epikodelabs/streamix';

const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("buffer", () => {
  let source: Writable<any>;

  beforeEach(() => { 
    source = atom<number>();
  });

  it("should emit buffered values at the specified interval", async () => {
    const duration = 200;
    const buffered = pipe(source, buffer(duration));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    await wait(duration + 50);
    source.next(4);
    await wait(duration + 50);
    source.dispose();
    await wait(duration);

    await completed;
    expect(results).toEqual([[1, 2, 3], [4]]);
  });

  it("should complete when the source completes", async () => {
    const duration = 200;
    const buffered = pipe(source, buffer(duration));
    let completed = false;

    const done = (async () => {
      for await (const _ of iterate(buffered)) {
        void _;
      }
      completed = true;
    })();

    source.next(1);
    await wait(100);
    source.dispose();
    await wait(duration);

    await done;
    expect(completed).toBeTrue();
  });

  it("should emit the last buffer when the source completes", async () => {
    const duration = 200;
    const buffered = pipe(source, buffer(duration));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    source.next(1);
    await wait(50);
    source.next(2);
    await wait(duration + 50);
    source.dispose();
    await wait(duration);

    await completed;
    expect(results).toEqual([[1, 2]]);
  });

  it("should propagate errors from the source stream", async () => {
    const duration = 200;
    const buffered = pipe(source, buffer(duration));
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

    source.next(1);
    await wait(50);
    source.fail(new Error("Test error"));

    await completed;
    expect(error?.message).toBe("Test error");
  });

  it("should emit empty arrays if no values are received in the interval", async () => {
    const duration = 200;
    const buffered = pipe(source, buffer(duration));
    const results: number[][] = [];

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    await wait(duration + 50);
    source.dispose();
    await wait(duration);

    await completed;
    expect(results).toEqual([]);
  });

  it("should cleanup when iterator is closed early via return()", async () => {
    const duration = 100;
    const buffered = pipe(source, buffer(duration));
    const results: number[][] = [];
    let iteratorReturned = false;

    const it = iterate(buffered)[Symbol.asyncIterator]();

    source.next(1);
    await wait(50);

    const firstResult = await it.next();
    if (!firstResult.done) {
      results.push(firstResult.value);
    }

    await it.return?.();
    iteratorReturned = true;

    source.next(2);
    source.next(3);
    await wait(150);

    const nextResult = await it.next();

    expect(iteratorReturned).toBe(true);
    expect(nextResult.done).toBe(true);
    expect(results.length).toBe(1);
  });

  // Note: atom-first API does not expose [Symbol.asyncIterator] or iterator.throw()
  // on atoms, so the throw() cleanup scenario cannot be expressed under the new semantics.
});
