import { DONE, interval, pipe, take, timer, type Readable } from '@epikodelabs/streamix';

// Let promise continuations and the delivery pump finish without advancing
// the mocked clock (timer producers await admission between ticks).
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const flushTimerWork = () => new Promise<void>(resolve => realSetTimeout(resolve, 0));

describe('timer and interval timing contract', () => {
  let subscriptions: Array<() => unknown>;

  beforeEach(() => {
    subscriptions = [];
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(0));
  });

  afterEach(async () => {
    try {
      await Promise.all(subscriptions.map(stop => stop()));
      await flushTimerWork();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  const observe = (source: Readable<number>) => {
    const ticks: Array<[number, number]> = [];
    const stop = source.subscribe(value => {
      if (value !== undefined) ticks.push([Date.now(), value]);
    });
    subscriptions.push(stop);
    return { ticks, stop };
  };

  const advance = async (ms: number) => {
    jasmine.clock().tick(ms);
    await flushTimerWork();
  };

  it('emits one-shot timer(due) at the due time and does not repeat', async () => {
    const { ticks } = observe(timer(20));
    await advance(19);
    expect(ticks).toEqual([]);
    await advance(1);
    expect(ticks).toEqual([[20, 0]]);
    await advance(100);
    expect(ticks).toEqual([[20, 0]]);
  });

  it('completes timer(due) after its single emission', async () => {
    const iterator = timer(20)[Symbol.asyncIterator]();
    subscriptions.push(() => iterator.return?.());

    const first = iterator.next();
    await advance(20);
    expect(await first).toEqual({ value: 0, done: false });
    expect(await iterator.next()).toEqual(DONE);
  });

  it('uses separate first-delay and repeat-period values', async () => {
    const { ticks } = observe(timer(30, 10));
    await advance(29);
    expect(ticks).toEqual([]);
    await advance(1);
    expect(ticks).toEqual([[30, 0]]);
    await advance(9);
    expect(ticks).toEqual([[30, 0]]);
    await advance(1);
    expect(ticks).toEqual([[30, 0], [40, 1]]);
    await advance(10);
    expect(ticks).toEqual([[30, 0], [40, 1], [50, 2]]);
  });

  it('delivers a zero-delay one-shot tick asynchronously before advancing time', async () => {
    const { ticks } = observe(timer(0));
    expect(ticks).toEqual([]);
    await flushTimerWork();
    expect(ticks).toEqual([[0, 0]]);
    await advance(100);
    expect(ticks).toEqual([[0, 0]]);
  });

  it('delivers a zero-delay first tick asynchronously before advancing time', async () => {
    const { ticks } = observe(timer(0, 10));
    expect(ticks).toEqual([]);
    await flushTimerWork();
    expect(ticks).toEqual([[0, 0]]);
    await advance(9);
    expect(ticks).toEqual([[0, 0]]);
    await advance(1);
    expect(ticks).toEqual([[0, 0], [10, 1]]);
  });

  it('waits one full period before interval emits its first tick', async () => {
    const { ticks } = observe(interval(25));
    expect(ticks).toEqual([]);
    await advance(24);
    expect(ticks).toEqual([]);
    await advance(1);
    expect(ticks).toEqual([[25, 0]]);
    await advance(24);
    expect(ticks).toEqual([[25, 0]]);
    await advance(1);
    expect(ticks).toEqual([[25, 0], [50, 1]]);
  });

  it('replays a completed one-shot value without restarting the timer', async () => {
    const source = timer(20);
    const first: number[] = [];
    subscriptions.push(
      source.subscribe(value => { if (value !== undefined) first.push(value); }),
    );

    await advance(20);
    expect(first).toEqual([0]);

    const late: number[] = [];
    subscriptions.push(
      source.subscribe(value => { if (value !== undefined) late.push(value); }),
    );
    await flushTimerWork();
    expect(late).toEqual([0]);

    await advance(100);
    expect(first).toEqual([0]);
    expect(late).toEqual([0]);
  });

  it('replays the current value to a subscriber that joins mid-stream', async () => {
    const source = timer(20, 10);
    const early: number[] = [];
    const late: number[] = [];
    subscriptions.push(
      source.subscribe(value => { if (value !== undefined) early.push(value); }),
    );

    await advance(20);
    subscriptions.push(
      source.subscribe(value => { if (value !== undefined) late.push(value); }),
    );
    expect(late).toEqual([0]);

    await advance(10);
    expect(early).toEqual([0, 1]);
    expect(late).toEqual([0, 1]);
  });

  it('keeps repeating while any subscriber remains and stops with the last', async () => {
    const source = timer(20, 10);
    const first: number[] = [];
    const second: number[] = [];
    const stopFirst = source.subscribe(value => { if (value !== undefined) first.push(value); });
    const stopSecond = source.subscribe(value => { if (value !== undefined) second.push(value); });
    subscriptions.push(stopFirst, stopSecond);

    await advance(20);
    expect(first).toEqual([0]);
    expect(second).toEqual([0]);

    await stopFirst();
    await advance(10);
    expect(first).toEqual([0]);
    expect(second).toEqual([0, 1]);

    await stopSecond();
    await advance(100);
    expect(second).toEqual([0, 1]);
  });

  it('cancels a one-shot timer before its due time', async () => {
    const { ticks, stop } = observe(timer(30));
    await advance(29);
    await stop();
    await advance(100);
    expect(ticks).toEqual([]);
  });

  it('cancels a repeating timer while waiting for its next tick', async () => {
    const { ticks, stop } = observe(timer(20, 25));
    await advance(20);
    expect(ticks).toEqual([[20, 0]]);
    await advance(24);
    await stop();
    await advance(100);
    expect(ticks).toEqual([[20, 0]]);
  });

  it('cancels interval before its first tick', async () => {
    const { ticks, stop } = observe(interval(25));
    await advance(24);
    await stop();
    await advance(100);
    expect(ticks).toEqual([]);
  });

  it('supports take(1) over a one-shot timer', async () => {
    const { ticks } = observe(pipe(timer(20), take(1)));
    await advance(19);
    expect(ticks).toEqual([]);
    await advance(1);
    expect(ticks).toEqual([[20, 0]]);
    await advance(100);
    expect(ticks).toEqual([[20, 0]]);
  });
});
