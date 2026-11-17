import { asReadable, atom, derived, flow, from, hasAtomEmitted, iterate, NO_INITIAL_VALUE } from '@epikodelabs/streamix';
import { getProducerCompletion } from '../lib/atoms/delivery';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe('producer completion', () => {
  it('releases one producer and retains the final state for late consumers', async () => {
    let starts = 0;
    let cleanups = 0;
    const source = flow(async function* () {
      starts++;
      try { yield 1; yield 2; }
      finally { cleanups++; }
    });
    try {
      expect(await collect(source)).toEqual([1, 2]);
      expect(source.disposed).toBeFalse();
      expect(source.value).toBe(2);
      expect(source.previous).toBe(1);
      expect(source.subscriberCount).toBe(0);
      expect(cleanups).toBe(1);

      const seen: number[] = [];
      const stop = source.subscribe(value => seen.push(value));
      expect(seen).toEqual([2]);
      await stop();
      expect(source.disposed).toBeFalse();
      expect(await collect(source)).toEqual([2]);
      expect(starts).toBe(1);
      source.dispose();
      expect(source.disposed).toBeTrue();
      expect(cleanups).toBe(1);
    } finally { source.dispose(); }
  });

  it('finishes empty sources without fabricating a value', async () => {
    const source = flow<number>([]);
    try {
      expect(await collect(source)).toEqual([]);
      expect(source.disposed).toBeFalse();
      expect(source.safeValue).toBe(NO_INITIAL_VALUE as any);
      expect(hasAtomEmitted(source)).toBeFalse();
      const listener = jasmine.createSpy('value');
      const stop = source.subscribe(listener);
      expect(listener).not.toHaveBeenCalled();
      await stop();
      expect(await collect(source)).toEqual([]);
      expect(source.disposed).toBeFalse();
    } finally { source.dispose(); }
  });

  it('distinguishes an emitted undefined value from empty completion', async () => {
    const source = flow([undefined]);
    try {
      expect(await collect(source)).toEqual([undefined]);
      expect(hasAtomEmitted(source)).toBeTrue();
      expect(source.value).toBeUndefined();
      expect(await collect(source)).toEqual([undefined]);
    } finally { source.dispose(); }
  });

  it('preserves queued callback delivery after the producer completes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const source = flow([1, 2, 3]);
    const seen: number[] = [];
    const stop = source.subscribe(async value => {
      seen.push(value);
      if (value === 1) await gate;
    });
    try {
      expect(await collect(source)).toEqual([1, 2, 3]);
      expect(seen).toEqual([1]);
      expect(source.value).toBe(3);
      release();
      await tick();
      expect(seen).toEqual([1, 2, 3]);
      await stop();
      expect(source.disposed).toBeFalse();
    } finally { release(); await stop(); source.dispose(); }
  });

  it('delivers the final analog value without duplicating it on completion', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const source = flow([1, 2, 3], { mode: 'analog' });
    const seen: number[] = [];
    const stop = source.subscribe(async value => {
      seen.push(value);
      if (value === 1) await gate;
    });
    try {
      await collect(source);
      expect(getProducerCompletion(source)?.completed).toBeTrue();
      expect(source.value).toBe(3);
      expect(source.dirty).toBeFalse();
      release();
      await tick();
      expect(seen).toEqual([1, 3]);
    } finally { release(); await stop(); source.dispose(); }
  });

  it('forwards completion through readonly views for direct iteration', async () => {
    const source = flow([1, 2]);
    const view = asReadable(source);
    try {
      expect(await collect(iterate(view))).toEqual([1, 2]);
      expect(await collect(iterate(view))).toEqual([2]);
      expect(view.value).toBe(2);
      expect(view.disposed).toBeFalse();
    } finally { source.dispose(); }
  });

  it('also forwards explicit disposal through readonly views', async () => {
    const source = atom<number>();
    const iterator = iterate(asReadable(source));
    const pending = iterator.next();
    source.dispose();
    expect((await pending).done).toBeTrue();
  });

  it('keeps completed source values available to derived atoms', async () => {
    const source = flow([2]);
    let result: ReturnType<typeof derived<number>> | undefined;
    try {
      await collect(source);
      result = derived(() => source.value * 2);
      expect(result.value).toBe(4);
    } finally { result?.dispose(); source.dispose(); }
  });

  it('replays only the retained current value after a from() producer completes', async () => {
    const source = from([1, 2]);
    const seen: number[] = [];
    const stop = source.subscribe(value => seen.push(value));
    try {
      for (let i = 0; i < 20 && !getProducerCompletion(source)?.completed; i++) await tick();
      expect(seen).toEqual([1, 2]);
      expect(source.value).toBe(2);
      expect(await collect(source)).toEqual([2]);
      await stop();
      expect(source.disposed).toBeFalse();
    } finally { await stop(); source.dispose(); }
  });

  it('uses retained state when a from() iterator is first pulled after completion', async () => {
    const source = from([1, 2]);
    const iterator = source[Symbol.asyncIterator]();
    const stop = source.subscribe(() => {});
    try {
      for (let i = 0; i < 20 && !getProducerCompletion(source)?.completed; i++) await tick();
      expect(getProducerCompletion(source)?.completed).toBeTrue();
      expect(await iterator.next()).toEqual({ value: 2, done: false });
      expect((await iterator.next()).done).toBeTrue();
      expect(source.disposed).toBeFalse();
    } finally { await iterator.return?.(); await stop(); source.dispose(); }
  });
});
