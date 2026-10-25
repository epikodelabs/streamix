import { atom, derived, flow } from '@epikodelabs/streamix';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Subscriber delivery guarantees, pinned as behavior:
 *
 * 1. An asynchronous subscriber callback is awaited before its next
 *    invocation — a busy callback is never re-entered.
 * 2. Delivery preserves FIFO emission order by default.
 * 3. Intermediate updates are never silently discarded by default: every
 *    emitted value reaches every subscriber exactly once, in order. (Explicit
 *    analog delivery — interval/timer analog mode — is the documented
 *    latest-only exception, not the default.)
 */
describe('subscriber delivery guarantees', () => {
  it('awaits an async subscriber callback before its next invocation', async () => {
    const source = atom(0);
    let active = 0;
    let maxActive = 0;
    const seen: number[] = [];

    const stop = source.subscribe(async value => {
      active++;
      maxActive = Math.max(maxActive, active);
      seen.push(value);
      await tick();
      active--;
    });

    source.set(1);
    source.set(2);
    source.set(3);

    // Let every queued delivery settle.
    for (let i = 0; i < 20 && seen.length < 4; i++) await tick();
    await tick();

    expect(maxActive).toBe(1);
    expect(seen).toEqual([0, 1, 2, 3]);
    stop();
  });

  it('delivers every intermediate update in FIFO order while the callback is busy', async () => {
    const source = atom(0);
    let release: (() => void) | undefined;
    const gate = () => new Promise<void>(resolve => { release = resolve; });
    const seen: number[] = [];

    let first = true;
    const stop = source.subscribe(async value => {
      seen.push(value);
      if (first) { first = false; await gate(); }
    });

    source.set(1);
    source.set(2);
    source.set(3);
    source.set(4);

    // The callback is still parked on its first invocation; nothing was lost.
    expect(seen).toEqual([0]);

    release?.();
    for (let i = 0; i < 20 && seen.length < 5; i++) await tick();

    expect(seen).toEqual([0, 1, 2, 3, 4]);
    stop();
  });

  it('chains previous values faithfully across queued deliveries', async () => {
    const source = atom(0);
    const pairs: Array<[number, number]> = [];
    let release: (() => void) | undefined;
    let first = true;

    const stop = source.subscribe(async (current, previous) => {
      pairs.push([current, previous]);
      if (first) { first = false; await new Promise<void>(resolve => { release = resolve; }); }
    });

    source.set(1);
    source.set(2);
    release?.();
    for (let i = 0; i < 20 && pairs.length < 3; i++) await tick();

    expect(pairs).toEqual([[0, 0], [1, 0], [2, 1]]);
    stop();
  });

  it('gives derived subscribers the same awaits and FIFO delivery', async () => {
    const source = atom(1);
    const doubled = derived(() => source.value * 2);
    const seen: number[] = [];
    let release: (() => void) | undefined;
    let first = true;

    const stop = doubled.subscribe(async value => {
      seen.push(value);
      if (first) { first = false; await new Promise<void>(resolve => { release = resolve; }); }
    });

    source.set(2);
    source.set(3);

    expect(seen).toEqual([2]);
    release?.();
    for (let i = 0; i < 20 && seen.length < 3; i++) await tick();

    expect(seen).toEqual([2, 4, 6]);
    stop();
  });

  it('delivers flow emissions to a busy async subscriber without loss', async () => {
    let step: (() => void) | undefined;
    let gate: (() => void) | undefined;
    const source = flow<number>(async function* () {
      for (const value of [1, 2, 3]) {
        yield value;
        await new Promise<void>(resolve => { step = resolve; });
      }
    });

    const seen: number[] = [];
    let first = true;
    const stop = source.subscribe(async value => {
      seen.push(value);
      if (first) { first = false; await new Promise<void>(resolve => { gate = resolve; }); }
    });

    for (let i = 0; i < 20 && seen.length === 0; i++) await tick();
    expect(seen).toEqual([1]);

    step?.(); // generator yields 2 and parks; 2 queues behind the busy callback
    gate?.(); // callback finishes 1 and drains 2
    for (let i = 0; i < 20 && seen.length < 2; i++) await tick();
    expect(seen).toEqual([1, 2]);

    step?.(); // generator yields 3; the callback drains it unprompted
    for (let i = 0; i < 20 && seen.length < 3; i++) await tick();
    expect(seen).toEqual([1, 2, 3]);
    stop();
  });

  it('stops delivering to an unsubscribed busy callback without dropping other subscribers', async () => {
    const source = atom(0);
    const a: number[] = [];
    const b: number[] = [];
    let release: (() => void) | undefined;

    let first = true;
    const stopA = source.subscribe(async value => {
      a.push(value);
      if (first) { first = false; await new Promise<void>(resolve => { release = resolve; }); }
    });
    const stopB = source.subscribe(value => { b.push(value); });

    source.set(1);
    expect(b).toEqual([0, 1]);
    stopA();
    release?.();
    await tick();

    source.set(2);
    // The queued value 1 is withheld from the unsubscribed busy callback —
    // removal wins over delivery — while the sync subscriber sees everything.
    expect(a).toEqual([0]);
    expect(b).toEqual([0, 1, 2]);
    stopB();
  });
});
