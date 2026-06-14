import { atom, iterate, pipe, sample } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('sample', () => {
  let subject: ReturnType<typeof atom>;

  beforeEach(() => {
    subject = atom<number>();
  });

  it('should emit the latest value at the specified interval', async () => {
    const period = 100;
    const sampled = pipe(subject, sample(period));
    const results: number[] = [];

    (async () => {
      for await (const value of iterate(sampled)) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(50);
    subject.next(2);
    await wait(125);
    subject.next(3);
    subject.dispose();

    await wait(200);

    expect(results).toEqual([2, 3]);
  });

  it('should complete when the source completes', async () => {
    const period = 100;
    const sampled = pipe(subject, sample(period));
    let completed = false;

    (async () => {
      for await (const _ of iterate(sampled)) {
        void _;
      }
      completed = true;
    })();

    subject.next(1);
    subject.dispose();
    await wait(150);

    expect(completed).toBeTrue();
  });

  it('should not emit anything if the source does not emit', async () => {
    const period = 100;
    const sampled = pipe(subject, sample(period));
    const results: number[] = [];

    (async () => {
      for await (const value of iterate(sampled)) {
        results.push(value);
      }
    })();

    await wait(200);

    expect(results).toEqual([]);
  });

  it('should emit the last value even if the source completes early', async () => {
    const period = 100;
    const sampled = pipe(subject, sample(period));
    const results: number[] = [];

    (async () => {
      for await (const value of iterate(sampled)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.dispose();
    await wait(150);

    expect(results).toEqual([2]);
  });

  it('should work with promise-based periods', async () => {
    const periodPromise = Promise.resolve(10);
    const sampled = pipe(subject, sample(periodPromise));
    const results: number[] = [];

    (async () => {
      for await (const value of iterate(sampled)) {
        results.push(value);
      }
    })();

    subject.next(5);
    await wait(15);
    subject.next(6);
    await wait(30);
    subject.dispose();
    await wait(20);

    expect(results.length).toBeGreaterThan(0);
    expect(results[results.length - 1]).toBe(6);
  });

  it('should forward period promise rejections as errors', async () => {
    const sampled = pipe(subject, sample(Promise.reject(new Error('boom'))));

    try {
      for await (const _ of iterate(sampled)) {
        void _;
      }
      fail('expected an error to be thrown');
    } catch (err: any) {
      expect(err.message).toBe('boom');
    }
  });
});
