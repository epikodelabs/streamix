import { atom, derived, transaction, NO_INITIAL_VALUE } from '../lib/atoms/atom';

describe('runtime graph invalidator registration', () => {
  it('recomputes after a writable dependency changes', () => {
    const source = atom(1);
    const result = derived(() => source.value * 2);
    expect(result.value).toBe(2);
    source.set(3);
    expect(result.value).toBe(6);
    result.dispose(); source.dispose();
  });

  it('publishes a consistent diamond result after a transaction', () => {
    const source = atom(1);
    const left = derived(() => source.value * 2);
    const right = derived(() => source.value + 10);
    const combined = derived(() => left.value + right.value);
    const observed: number[] = [];
    const subscription = combined.subscribe(value => observed.push(value));
    transaction(() => source.set(2));
    expect(combined.value).toBe(16);
    expect(observed).toEqual([13, 16]);
    subscription(); combined.dispose(); right.dispose(); left.dispose(); source.dispose();
  });

  it('replaces conditional dependencies and recovers from unavailable branches', () => {
    const flag = atom(false);
    const a = atom(10);
    const b = atom<number>();
    const result = derived(() => flag.value ? b.value : a.value);
    expect(result.value).toBe(10);
    flag.set(true);
    expect(result.value).toBe(NO_INITIAL_VALUE as any);
    a.set(11);
    expect(result.value).toBe(NO_INITIAL_VALUE as any);
    b.set(22);
    expect(result.value).toBe(22);
    result.dispose(); b.dispose(); a.dispose(); flag.dispose();
  });
});
