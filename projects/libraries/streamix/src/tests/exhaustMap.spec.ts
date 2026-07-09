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

    const err$ = (async () => {
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
    const error = await err$;

    expect(error).toBeInstanceOf(Error);
    expect((error as any)!.message).toBe('boom');
    expect(results).toEqual([1]);
  });

  it('continues to source completion when the outer source has no synchronous buffer hooks', async () => {
    let calls = 0;
    const source = {
      async next() {
        calls++;
        if (calls === 1) {
          return { value: 1, done: false as const };
        }

        return { value: undefined, done: true as const };
      }
    } as AsyncIterator<number>;

    const iterator = exhaustMap((value: number) => [value]).apply(source);

    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('drops synchronously buffered outer values while an inner stream is active and stops when the source buffer reports done', async () => {
    let calls = 0;
    const source = {
      async next() {
        calls++;
        return calls === 1
          ? { value: 1, done: false as const }
          : { value: undefined, done: true as const };
      },
      __tryNext() {
        return calls === 1
          ? null
          : { value: undefined, done: true as const };
      }
    } as AsyncIterator<number> & { __tryNext: () => IteratorResult<number> | null };

    const iterator = exhaustMap((value: number) => [value]).apply(source);

    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('supports synchronous projected values and direct return/throw cleanup', async () => {
    const sourceReturn = jasmine.createSpy('sourceReturn').and.resolveTo({ value: undefined, done: true });
    let calls = 0;
    const source = {
      async next() {
        calls++;
        return calls === 1
          ? { value: 2, done: false as const }
          : new Promise<IteratorResult<number>>(() => {});
      },
      return: sourceReturn,
    } as AsyncIterator<number>;

    const iterator = exhaustMap((value: number) => value * 10).apply(source);

    expect(await iterator.next()).toEqual({ value: 20, done: false });
    expect(await iterator.return?.()).toEqual({ value: undefined, done: true });
    expect(sourceReturn).toHaveBeenCalled();

    const throwingIterator = exhaustMap((value: number) => value * 10).apply({
      async next() {
        return { value: 3, done: false as const };
      },
      return: sourceReturn,
    } as AsyncIterator<number>);

    await expectAsync(throwingIterator.throw?.('stop')).toBeRejectedWithError('stop');
  });
});
