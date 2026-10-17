import { atomFromIterator } from '../lib/atoms/atom';
import { internalRuntime } from '../lib/runtime/runtime';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 10));

function controllableSource<T>() {
  let starts = 0;
  let returns = 0;
  let ended = false;
  const pending: Array<(result: IteratorResult<T>) => void> = [];
  const values: Array<IteratorResult<T>> = [];
  const end = () => {
    ended = true;
    while (pending.length) pending.shift()!({ done: true, value: undefined as T });
  };
  return {
    get starts() { return starts; },
    get returns() { return returns; },
    emit(value: T) {
      const result = { done: false as const, value };
      if (pending.length) pending.shift()!(result);
      else values.push(result);
    },
    end,
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        starts++;
        return {
          next() {
            if (values.length) return Promise.resolve(values.shift()!);
            if (ended) return Promise.resolve({ done: true as const, value: undefined as T });
            return new Promise<IteratorResult<T>>(resolve => pending.push(resolve));
          },
          async return() {
            returns++;
            end();
            return { done: true as const, value: undefined as T };
          },
        };
      },
    },
  };
}

describe('runtime shared flow producer lifecycle', () => {
  it('shares a producer, preserves remaining subscribers, and closes the iterator once', async () => {
    const source = controllableSource<number>();
    const valuesA: number[] = [], valuesB: number[] = [];
    const flow = atomFromIterator(source.iterable);
    const a = flow.subscribe(v => { valuesA.push(v); });
    const b = flow.subscribe(v => { valuesB.push(v); });
    await tick();
    expect(source.starts).toBe(1);
    source.emit(3); await tick();
    await a();
    source.emit(4); await tick();
    expect(valuesA).toEqual([3]);
    expect(valuesB).toEqual([3, 4]);
    expect(flow.disposed).toBe(false);
    await b();
    expect(source.returns).toBe(1);
    expect(flow.disposed).toBe(true);
  });

  it('replays the current value without restarting the shared producer', async () => {
    const source = controllableSource<number>();
    const flow = atomFromIterator(source.iterable);
    const first = flow.subscribe(() => {});
    source.emit(9); await tick();
    const received: number[] = [];
    const second = flow.subscribe(v => { received.push(v); });
    await tick();
    expect(source.starts).toBe(1);
    expect(received).toEqual([9]);
    await first(); await second();
  });

  it('keeps undefined distinct from NO_INITIAL_VALUE', async () => {
    const source = controllableSource<undefined>();
    const flow = atomFromIterator(source.iterable);
    const received: undefined[] = [];
    const sub = flow.subscribe(v => { received.push(v); });
    source.emit(undefined); await tick();
    expect(received).toEqual([undefined]);
    await sub();
  });

  it('releases runtime execution accounting after final detachment', async () => {
    const source = controllableSource<number>();
    const flow = atomFromIterator(source.iterable);
    const before = internalRuntime.executions.snapshot().active;
    const a = flow.subscribe(() => {});
    const b = flow.subscribe(() => {});
    await tick();
    expect(internalRuntime.executions.snapshot().active).toBe(before + 1);
    await a(); await b();
    expect(internalRuntime.executions.snapshot().active).toBe(before);
    expect(source.returns).toBe(1);
  });
});
