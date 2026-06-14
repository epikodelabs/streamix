import { atom, exhaustMap, iterate, pipe } from '@epikodelabs/streamix';

let previousTimeoutInterval = jasmine.DEFAULT_TIMEOUT_INTERVAL;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('exhaustMap', () => {
  beforeAll(() => {
    previousTimeoutInterval = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = previousTimeoutInterval;
  });

  it('does not start a second inner stream while the first is active', async () => {
    const subject = atom<number>();
    const results: number[] = [];
    let projectCalls = 0;

    const output = pipe(
      subject,
      exhaustMap((value) => {
        projectCalls++;
        return new Promise<number>((resolve) => setTimeout(() => resolve(value), 20));
      })
    );

    const reader = (async () => {
      for await (const value of iterate(output)) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(5);
    subject.next(2);
    subject.next(3);
    await wait(150);
    subject.dispose();
    await reader;

    expect(results).toEqual([1]);
    expect(projectCalls).toBe(1);
  });

  it('restarts after the inner stream completes', async () => {
    const subject = atom<number>();
    const results: number[] = [];
    let projectCalls = 0;

    const output = pipe(
      subject,
      exhaustMap((value) => {
        projectCalls++;
        return new Promise<number>((resolve) => setTimeout(() => resolve(value), 50));
      })
    );

    const reader = (async () => {
      for await (const value of iterate(output)) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(10);
    subject.next(2);
    subject.next(3);
    await wait(60);
    subject.next(4);
    await wait(60);
    subject.dispose();
    await reader;

    expect(results).toEqual([1, 4]);
    expect(projectCalls).toBe(2);
  });

  it('propagates inner errors and ignores later sources', async () => {
    const subject = atom<number>();
    const results: number[] = [];

    const output = pipe(
      subject,
      exhaustMap((value) => {
        if (value === 1) {
          return new Promise<number>((resolve) => setTimeout(() => resolve(value), 10));
        }
        if (value === 2) {
          throw new Error('boom');
        }
        return [value];
      })
    );

    const errPromise = (async () => {
      try {
        for await (const value of iterate(output)) {
          results.push(value);
        }
        return null;
      } catch (err) {
        return err;
      }
    })();

    subject.next(1);
    await wait(5);
    subject.next(3);
    await wait(10);
    subject.next(2);
    const error = await errPromise;

    expect(error).toBeInstanceOf(Error);
    expect((error as any)!.message).toBe('boom');
    expect(results).toEqual([1]);
  });
});
