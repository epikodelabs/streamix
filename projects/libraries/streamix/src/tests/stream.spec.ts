import { createAsyncIterator, createStream, createSubject, createSubscription, from, isStreamLike, map } from '@epikodelabs/streamix';

describe('stream', () => {
  it('allows base streams to be consumed with for-await', async () => {
    const values: number[] = [];

    for await (const value of from([1, 2, 3])) {
      values.push(value);
    }

    expect(values).toEqual([1, 2, 3]);
  });

  it('keeps piped streams iterable', async () => {
    const doubled = from([1, 2]).pipe(map(v => v * 2));
    const values: number[] = [];

    for await (const value of doubled) {
      values.push(value);
    }

    expect(values).toEqual([2, 4]);
  });

  it('supports async iteration over subjects', async () => {
    const subject = createSubject<number>();
    const received: number[] = [];

    const iterate = (async () => {
      for await (const value of subject) {
        received.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.complete();

    await iterate;
    expect(received).toEqual([1, 2]);
  });

  it('calls complete on unsubscribe for streams', (done) => {
    const stream = from([1, 2, 3]);
    let completeCalls = 0;
    let subscription: any;

    subscription = stream.subscribe({
      next: () => {
        subscription.unsubscribe();
      },
      complete: () => {
        completeCalls++;
        setTimeout(() => {
          expect(completeCalls).toBe(1);
          done();
        }, 0);
      }
    });
  });

  it('calls complete after error for cleanup', (done) => {
    const stream = createStream('error-stream', async function* () {
      throw new Error('boom');
    });

    const events: string[] = [];

    stream.subscribe({
      error: (err) => {
        events.push('error');
        expect(err.message).toBe('boom');
      },
      complete: () => {
        events.push('complete');
        expect(events).toEqual(['error', 'complete']);
        done();
      }
    });
  });

  it('multicasts values to multiple subscribers', (done) => {
    const a: number[] = [];
    const b: number[] = [];

    const s = createStream('multi', async function* (_signal) {
      // allow subscribers to attach
      await Promise.resolve();
      yield 1;
      yield 2;
    });

    s.subscribe({ next: (v) => a.push(v) });
    s.subscribe({
      next: (v) => b.push(v),
      complete: () => {
        expect(a).toEqual([1, 2]);
        expect(b).toEqual([1, 2]);
        done();
      },
    });
  });

  it('iterator early return triggers generator cleanup', (done) => {
    let cleaned = false;

    const s = createStream('cleanup', async function* (_signal) {
      try {
        yield 1;
        await new Promise<void>((resolve) =>
          (_signal as AbortSignal | undefined)?.addEventListener('abort', () => resolve(), { once: true })
        );
      } finally {
        cleaned = true;
      }
    });

    (async () => {
      const it = s[Symbol.asyncIterator]();
      const first = await it.next();
      expect(first.done).toBeFalse();
      expect(first.value).toBe(1);

      if (it.return) await it.return();

      // give the runtime a tick for abort/cleanup
      setTimeout(() => {
        expect(cleaned).toBeTrue();
        done();
      }, 0);
    })();
  });

  /* Abstractions / stream tests merged */
  it('createAsyncGenerator buffers values and defers terminal until drained', async () => {
    const registered: any[] = [];
    const register = (r: any) => {
      registered.push(r);
      return createSubscription();
    };

    const it = createAsyncIterator<number>({ register })();

    // start a pending pull
    const pending = it.next();

    // push a value into the underlying receiver
    registered[0].next(42);

    expect(await pending).toEqual({ done: false, value: 42 });

    // push another value and then a completion; completion must wait until buffered values are consumed
    registered[0].next(7);
    registered[0].complete();

    // next() should return the buffered value 7, then subsequent next() should indicate completion
    const r2 = await it.next();
    expect(r2).toEqual({ done: false, value: 7 });

    const r3 = await it.next();
    expect(r3).toEqual({ done: true, value: undefined });
  });

  it('iterator exposes __tryNext for synchronous pulls', async () => {
    const registered: any[] = [];
    const register = (r: any) => {
      registered.push(r);
      return createSubscription();
    };

    const it: any = createAsyncIterator<number>({ register })();

    // queue values by sending via receiver
    registered[0]?.next?.(1);
    registered[0]?.next?.(2);

    // __tryNext should return the first buffered value synchronously
    const maybe = it.__tryNext?.();
    expect(maybe).toEqual({ done: false, value: 1 });

    // and we can drain the remaining via normal next()
    const rest = await it.next();
    expect(rest).toEqual({ done: false, value: 2 });
  });

  it('isStreamLike recognizes streams and non-streams', () => {
    const s = createStream('x', async function* () {});
    expect(isStreamLike(s)).toBeTrue();
    expect(isStreamLike({})).toBeFalse();
  });

  it('createStream aborts generator when last subscriber unsubscribes', (done) => {
    let cleaned = false;

    const s = createStream('abort-on-unsub', async function* (signal: AbortSignal | undefined) {
      try {
        yield 1;
        await new Promise<void>((resolve) =>
          (signal as AbortSignal | undefined)?.addEventListener('abort', () => resolve(), { once: true })
        );
      } finally {
        cleaned = true;
      }
    });

    const sub = s.subscribe({ next: () => {} });

    // unsubscribe and allow tick for cleanup
    sub.unsubscribe();

    setTimeout(() => {
      expect(cleaned).toBeTrue();
      done();
    }, 0);
  });
});



