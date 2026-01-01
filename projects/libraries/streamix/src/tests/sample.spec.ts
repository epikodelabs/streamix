import { createSubject, sample } from '@epikodelabs/streamix';

describe("sample", () => {
  let subject: any;

  beforeEach(() => {
    subject = createSubject<number>();
  });

  it("should emit the latest value at the specified interval", async () => {
    const period = 100;
    const sampled = subject.pipe(sample(period));
    const results: number[] = [];

    (async () => {
      for await (const value of sampled) {
        results.push(value);
      }
    })();

    subject.next(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    subject.next(2);
    await new Promise((resolve) => setTimeout(resolve, 125));
    subject.next(3);
    subject.complete();

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(results).toEqual([2, 3]); // The latest values should be emitted
  });

  it("should complete when the source completes", async () => {
    const period = 100;
    const sampled = subject.pipe(sample(period));
    let completed = false;

    (async () => {
      for await (const _ of sampled) {
        void _;
      }
      completed = true;
    })();

    subject.next(1);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(completed).toBeTrue();
  });

  it("should not emit anything if the source does not emit", async () => {
    const period = 100;
    const sampled = subject.pipe(sample(period));
    const results: number[] = [];

    (async () => {
      for await (const value of sampled) {
        results.push(value);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(results).toEqual([]); // No values emitted
  });

  it("should emit the last value even if the source completes early", async () => {
    const period = 100;
    const sampled = subject.pipe(sample(period));
    const results: number[] = [];

    (async () => {
      for await (const value of sampled) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(results).toEqual([2]); // The last value before completion should be emitted
  });

  it("should work with promise-based periods", async () => {
    const periodPromise = Promise.resolve(10);
    const sampled = subject.pipe(sample(periodPromise));
    const results: number[] = [];

    (async () => {
      for await (const value of sampled) {
        results.push(value);
      }
    })();

    subject.next(5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    subject.next(6);
    await new Promise((resolve) => setTimeout(resolve, 30));
    subject.complete();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(results.length).toBeGreaterThan(0);
    expect(results[results.length - 1]).toBe(6);
  });

  it("should forward period promise rejections as errors", async () => {
    const sampled = subject.pipe(sample(Promise.reject(new Error("boom"))));

    try {
      for await (const _ of sampled) {
        void _;
      }
      fail("expected an error to be thrown");
    } catch (err: any) {
      expect(err.message).toBe("boom");
    }
  });
});


