import { atom, derived, NO_INITIAL_VALUE, atomFromIterator } from '../lib/atoms/atom';

describe('runtime value availability and dynamic dependencies', () => {
  it('waits for each required atom without treating undefined as unavailable', () => {
    const a = atom<number>(NO_INITIAL_VALUE);
    const b = atom<number | undefined>(NO_INITIAL_VALUE);
    const sum = derived(() => a.value + (b.value ?? 0));
    expect(sum.value).toBe(NO_INITIAL_VALUE as any);
    a.set(3);
    expect(sum.value).toBe(NO_INITIAL_VALUE as any);
    b.set(undefined);
    expect(sum.value).toBe(3);
    sum.dispose(); a.dispose(); b.dispose();
  });

  it('switches branches and drops obsolete subscriptions', () => {
    const select = atom(false);
    const a = atom(2);
    const b = atom<number>(NO_INITIAL_VALUE);
    const result = derived(() => select.value ? b.value : a.value);
    expect(result.value).toBe(2);
    select.set(true);
    expect(result.value).toBe(NO_INITIAL_VALUE as any);
    b.set(8);
    expect(result.value).toBe(8);
    a.set(99);
    expect(result.value).toBe(8);
    select.set(false);
    expect(result.value).toBe(99);
    result.dispose(); select.dispose(); a.dispose(); b.dispose();
  });

  it('can recover when a flow produces its first value', async () => {
    let emit!: (value: number) => void;
    const source = {
      async *[Symbol.asyncIterator]() {
        const first = await new Promise<number>(resolve => { emit = resolve; });
        yield first;
      }
    };
    const input = atomFromIterator(source);
    const doubled = derived(() => input.value * 2);
    expect(doubled.value).toBe(NO_INITIAL_VALUE as any);
    const sub = input.subscribe(() => {});
    await Promise.resolve();
    emit(7);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(doubled.value).toBe(14);
    sub(); doubled.dispose(); input.dispose();
  });
});
