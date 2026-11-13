import { DONE, fromPush, type PushSink } from '@epikodelabs/streamix';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('fromPush()', () => {
  it('lazily shares one producer and disconnects on the last consumer', async () => {
    const cleanups: number[] = [];
    let starts = 0;
    let sink!: PushSink<number>;
    let signal!: AbortSignal;
    const source = fromPush<number>((nextSink, nextSignal) => {
      sink = nextSink;
      signal = nextSignal;
      starts++;
      return () => { cleanups.push(starts); };
    }, { name: 'numbers' });

    expect(starts).toBe(0);
    expect(source.name).toBe('numbers');
    const a: number[] = [];
    const b: number[] = [];
    const first = source.subscribe(value => a.push(value));
    const second = source.subscribe(value => b.push(value));
    expect(starts).toBe(1);
    expect(source.subscriberCount).toBe(2);

    await sink.next(1);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    await first();
    expect(cleanups).toEqual([]);
    await second();
    expect(cleanups).toEqual([1]);
    expect(signal.aborted).toBeTrue();

    const third = source.subscribe();
    expect(starts).toBe(2);
    await third();
    source.dispose();
  });

  it('replays the latest snapshot and serializes async callbacks', async () => {
    let sink!: PushSink<number>;
    const source = fromPush<number>(s => { sink = s; });
    const order: string[] = [];
    let finished = 0;
    let markFinished!: () => void;
    const allFinished = new Promise<void>(resolve => { markFinished = resolve; });
    const first = source.subscribe(async value => {
      order.push(`start ${value}`);
      await tick();
      order.push(`end ${value}`);
      if (++finished === 2) markFinished();
    });
    await Promise.all([sink.next(1), sink.next(2)]);
    await allFinished;
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);

    const replay: Array<[number, number]> = [];
    let markReplayed!: () => void;
    const replayed = new Promise<void>(resolve => { markReplayed = resolve; });
    const second = source.subscribe((current, previous) => {
      replay.push([current, previous]);
      if (replay.length === 2) markReplayed();
    });
    expect(replay).toEqual([[2, 2]]);
    expect(source.value).toBe(2);
    await sink.next(3);
    await replayed;
    expect(replay).toEqual([[2, 2], [3, 3]]);
    await first();
    await second();
    source.dispose();
  });

  it('drains accepted events before completing', async () => {
    let sink!: PushSink<number>;
    const source = fromPush<number>(s => { sink = s; });
    const iterator = source[Symbol.asyncIterator]();
    const first = sink.next(10);
    const second = sink.next(20);
    sink.complete();
    await Promise.all([first, second]);

    expect(await iterator.next()).toEqual({ done: false, value: 10 });
    expect(await iterator.next()).toEqual({ done: false, value: 20 });
    expect(await iterator.next()).toEqual(DONE);
    expect(source.value).toBe(20);
    await iterator.return?.();
    source.dispose();
  });

  it('propagates errors and cancels the producer', async () => {
    let sink!: PushSink<number>;
    let signal!: AbortSignal;
    const source = fromPush<number>((s, controllerSignal) => {
      sink = s;
      signal = controllerSignal;
    });
    const errors: Error[] = [];
    const unsubscribeError = source.onError(error => errors.push(error));
    const iterator = source[Symbol.asyncIterator]();
    const pending = iterator.next();
    const assertion = expectAsync(pending).toBeRejectedWithError('failed');
    sink.error('failed');
    await assertion;
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('failed');
    expect(signal.aborted).toBeTrue();
    await iterator.return?.();
    await unsubscribeError();
    source.dispose();
  });

  it('resolves next() once the value is buffered, without waiting for async subscribers', async () => {
    let sink!: PushSink<number>;
    const source = fromPush<number>(s => { sink = s; }, { capacity: 2 });
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const subscription = source.subscribe(async () => {
      markStarted();
      await new Promise<void>(resolve => { release = resolve; });
    });

    let resolved = false;
    const pushed = sink.next(1).then(() => { resolved = true; });
    await started;
    expect(resolved).toBeTrue();

    release();
    await pushed;
    await subscription();
    source.dispose();
  });

  it('applies backpressure only when the bounded buffer is full', async () => {
    let sink!: PushSink<number>;
    const source = fromPush<number>(s => { sink = s; }, { capacity: 1 });
    const iterator = source[Symbol.asyncIterator]();
    await sink.next(1);
    // Admission, not delivery: this resolves without waiting for the consumer.
    await sink.next(2);

    let thirdResolved = false;
    const third = sink.next(3).then(() => { thirdResolved = true; });
    await tick();
    expect(thirdResolved).toBeFalse();

    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    await third;
    expect(await iterator.next()).toEqual({ done: false, value: 2 });
    expect(await iterator.next()).toEqual({ done: false, value: 3 });
    await iterator.return?.();
    source.dispose();
  });

  it('keeps only the latest unread event in analog mode', async () => {
    let sink!: PushSink<number>;
    const source = fromPush<number>(s => { sink = s; }, { mode: 'analog' });
    const iterator = source[Symbol.asyncIterator]();
    await Promise.all([sink.next(1), sink.next(2), sink.next(3)]);
    expect(await iterator.next()).toEqual({ done: false, value: 3 });
    await iterator.return?.();
    source.dispose();
  });

  it('releases an asynchronous connector even after unsubscribe', async () => {
    let release!: (cleanup: () => void) => void;
    let cleanups = 0;
    const source = fromPush<number>(() => new Promise<void | (() => void)>(resolve => { release = resolve; }));
    const subscription = source.subscribe();
    const stopped = subscription();
    release(() => { cleanups++; });
    await stopped;
    expect(cleanups).toBe(1);
    source.dispose();
  });

  it('isolates sessions so an old callback cannot inject into a new connection', async () => {
    const sinks: PushSink<number>[] = [];
    const source = fromPush<number>(sink => { sinks.push(sink); });
    const first = source.subscribe();
    await first();
    const events: number[] = [];
    const second = source.subscribe(value => events.push(value));
    await sinks[0].next(999);
    await sinks[1].next(3);
    expect(events).toEqual([3]);
    await second();
    source.dispose();
  });

  it('validates capacity and fails on explicit overflow policy', async () => {
    expect(() => fromPush(() => {}, { capacity: 0 })).toThrowError(RangeError);
    let sink!: PushSink<number>;
    const source = fromPush<number>(s => { sink = s; }, { capacity: 1, overflow: 'error' });
    const errors: Error[] = [];
    const sub = source.subscribe(async () => { await tick(); });
    const errSub = source.onError(error => errors.push(error));
    const first = sink.next(1);
    const second = sink.next(2);
    const third = sink.next(3);
    await Promise.all([first, second, third]);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('capacity');
    await sub();
    await errSub();
    source.dispose();
  });
});
