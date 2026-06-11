import { atom, fromAtom, delay, exhaustMap, from } from '@epikodelabs/streamix';

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
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const results: number[] = [];
    let projectCalls = 0;

    const stream = subject.pipe(
      exhaustMap((value) => {
        projectCalls++;
        return from([value]).pipe(delay(20));
      })
    );

    const reader = (async () => {
      for await (const value of stream) {
        results.push(value);
      }
    })();

    source$.set(1);
    await wait(5);
    source$.set(2);
    source$.set(3);
    await wait(150);
    source$.dispose();
    await reader;

    expect(results).toEqual([1]);
    expect(projectCalls).toBe(1);
  });

  it('restarts after the inner stream completes', async () => {
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const results: number[] = [];
    let projectCalls = 0;

    const stream = subject.pipe(
      exhaustMap((value) => {
        projectCalls++;
        return from([value]).pipe(delay(50));
      })
    );

    const reader = (async () => {
      for await (const value of stream) {
        results.push(value);
      }
    })();

    source$.set(1);
    await wait(10);
    source$.set(2);
    source$.set(3);
    await wait(60);
    source$.set(4);
    await wait(60);
    source$.dispose();
    await reader;

    expect(results).toEqual([1, 4]);
    expect(projectCalls).toBe(2);
  });

  it('propagates inner errors and ignores later sources', async () => {
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const results: number[] = [];

    const stream = subject.pipe(
      exhaustMap((value) => {
        if (value === 1) {
          return from([value]).pipe(delay(10));
        }
        if (value === 2) {
          throw new Error('boom');
        }
        return from([value]);
      })
    );

    const errPromise = (async () => {
      try {
        for await (const value of stream) {
          results.push(value);
        }
        return null;
      } catch (err) {
        return err;
      }
    })();

    source$.set(1);
    await wait(5);
    source$.set(3);
    await wait(10);
    source$.set(2);
    const error = await errPromise;

    expect(error).toBeInstanceOf(Error);
    expect((error as any)!.message).toBe('boom');
    expect(results).toEqual([1]);
  });
});
