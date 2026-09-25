import {
  effectScope,
  type EffectScope,
} from 'vue';
import {
  atom,
  type Atom,
} from '@epikodelabs/streamix';
import { useIterable } from '../src/lib/useIterable';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useIterable', () => {
  let vueScope: EffectScope;

  beforeEach(() => {
    vueScope = effectScope();
  });

  afterEach(() => {
    vueScope.stop();
  });

  it('reads the current Streamix value and stays live', () => {
    const count = atom(0);
    const value = vueScope.run(() => useIterable(count))!;

    expect(value.value).toBe(0);

    count.next(1);
    expect(value.value).toBe(1);
  });

  it('invalidates even when the source emits the same object identity', () => {
    const object = { count: 0 };
    const source = atom(object);
    const value = vueScope.run(() => useIterable(source))!;

    object.count = 1;
    source.next(object);

    expect(value.value).toBe(object);
    expect(value.value.count).toBe(1);
  });

  it('unsubscribes when the current Vue effect scope stops', () => {
    const count = atom(0);

    vueScope.run(() => useIterable(count));
    expect(count.subscriberCount).toBe(1);

    vueScope.stop();
    expect(count.subscriberCount).toBe(0);
  });

  it('does not dispose an externally-owned source', () => {
    const count = atom(0);

    vueScope.run(() => useIterable(count));
    vueScope.stop();

    expect(count.disposed).toBe(false);
  });

  it('disposes a factory-owned Streamix source', () => {
    let created!: Atom<number>;

    vueScope.run(() => useIterable(() => {
      created = atom(0);
      return created;
    }));

    expect(created.disposed).toBe(false);
    vueScope.stop();
    expect(created.disposed).toBe(true);
  });

  it('uses initialValue when a dependency source currently exposes undefined', () => {
    const source = atom<number | undefined>(undefined);
    const value = vueScope.run(() => useIterable(source, -1))!;

    expect(value.value).toBe(-1);
  });

  it('consumes a plain async iterable and exposes its latest emission', async () => {
    let emit!: (value: number) => void;

    async function* values() {
      while (true) {
        const value = await new Promise<number>((resolve) => {
          emit = resolve;
        });
        yield value;
      }
    }

    const value = vueScope.run(() => useIterable(values(), -1))!;
    expect(value.value).toBe(-1);

    emit(7);
    await flushMicrotasks();

    expect(value.value).toBe(7);
  });

  it('closes a plain async iterator when the Vue effect scope stops', async () => {
    let closed = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return: async () => {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };

    vueScope.run(() => useIterable(source, 0));
    vueScope.stop();
    await flushMicrotasks();

    expect(closed).toBe(true);
  });
});
