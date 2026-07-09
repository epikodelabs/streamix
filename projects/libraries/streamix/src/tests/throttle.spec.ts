import { atom, from, iterate, pipe, throttle, type Writable } from '@epikodelabs/streamix';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('throttle', () => {
  it('should emit first value immediately and throttle subsequent values', async () => {
    const output: number[] = [];
    const subject: Writable<any> = atom<number>();
    const reader = (async () => {
      for await (const v of iterate(pipe(subject, throttle<number>(100)))) {
        output.push(v);
      }
    })();

    subject.next(1); // emitted immediately
    subject.next(2); // suppressed
    await sleep(60); // still within the first window
    subject.next(3); // replaces pending trailing value
    await sleep(70); // window expires, trailing 3 is emitted
    subject.next(4); // emitted immediately in the new window
    subject.dispose();

    await reader;

    expect(output[0]).toBe(1);
    expect(output).toEqual([1, 3, 4]);
  });

  it('should complete after source completes', async () => {
    const subject: Writable<any> = atom<number>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(subject, throttle<number>(50)))) {
        void _;
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.dispose();

    await reader; // This will resolve when the loop completes.
  });

  it('should forward errors from the source', async () => {
    const subject: Writable<any> = atom<number>();
    let caught: any = null;

    const reader = (async () => {
      try {
        for await (const _ of iterate(pipe(subject, throttle<number>(50)))) {
          void _;
        }
        fail('The promise should have been rejected');
      } catch (err) {
        caught = err;
      }
    })();

    const error = new Error('test error');
    subject.fail(error);

    await reader;

    expect(caught).toBe(error);
  });

  it('should flush the trailing value when the source completes during cooldown', async () => {
    const output: number[] = [];
    const subject: Writable<any> = atom<number>();
    const reader = (async () => {
      for await (const v of iterate(pipe(subject, throttle<number>(50)))) {
        output.push(v);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.dispose();

    await reader;

    expect(output).toEqual([1, 2]);
  });

  it('should emit every value when values are spaced beyond duration', async () => {
    const output: number[] = [];
    const subject: Writable<any> = atom<number>();
    const reader = (async () => {
      for await (const v of iterate(pipe(subject, throttle<number>(20)))) {
        output.push(v);
      }
    })();

    subject.next(1);
    await sleep(30);
    subject.next(2);
    await sleep(30);
    subject.next(3);
    subject.dispose();

    await reader; // Wait for the stream to finish
    expect(output).toEqual([1, 2, 3]); // Assert the final output
  });

  it('should not throttle when duration is 0', async () => {
    const output: number[] = [];
    const subject: Writable<any> = atom<number>();

    const reader = (async () => {
      for await (const v of iterate(pipe(subject, throttle<number>(0)))) {
        output.push(v);
      }
    })();

    await sleep(50);

    subject.next(1);
    subject.next(2);
    subject.next(3);
    
    subject.dispose();
    await reader;

    expect(output).toEqual([1, 2, 3]);
  });

  it('should wait for promised duration before starting throttle window', async () => {
    const output: number[] = [];
    const subject = atom<number>();

    const duration = new Promise<number>((resolve) =>
      setTimeout(() => resolve(100), 50)
    );

    const reader = (async () => {
      for await (const v of iterate(pipe(subject, throttle(duration)))) {
        output.push(v);
      }
    })();

    await sleep(50);
     // Ensure the duration promise hasn't resolved yet
    subject.next(1);
    subject.next(2);

    await sleep(200);

    subject.dispose();
    await reader;
    
    expect(output).toEqual([1, 2]);
  });

  it('should flush a queued trailing value before the next leading value when the timer has not fired yet', async () => {
    const dateNowSpy = spyOn(Date, 'now').and.returnValues(0, 50, 150, 150);
    const output: number[] = [];

    for await (const value of iterate(pipe(from([1, 2, 3]), throttle<number>(100)))) {
      output.push(value);
    }

    expect(dateNowSpy).toHaveBeenCalled();
    expect(output).toEqual([1, 2, 3]);
  });

  it('should normalize non-Error source failures and clear pending timers', async () => {
    const subject: Writable<any> = atom<number>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(subject, throttle<number>(50)))) {
        void _;
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.fail('boom' as any);

    await expectAsync(reader).toBeRejectedWithError('boom');
  });

  it('should clear a pending timer when downstream stops during cooldown', async () => {
    const subject: Writable<any> = atom<number>();
    const iterator = iterate(pipe(subject, throttle<number>(50)))[Symbol.asyncIterator]();

    subject.next(1);
    expect(await iterator.next()).toEqual({ value: 1, done: false });

    subject.next(2);
    expect(await iterator.return?.()).toEqual({ value: undefined, done: true });

    await sleep(70);
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
