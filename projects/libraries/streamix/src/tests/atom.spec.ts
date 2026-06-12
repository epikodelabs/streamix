import { atom, derived, flow, fromAtom, scope } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('flow', () => {
  it('should hold an initial value when using startWith', async () => {
    const source$ = atom<number>(42);
    const a = flow(fromAtom(source$));
    await delay();
    expect(a.get()).toBe(42);
    expect(a.value).toBe(42);
    a.dispose();
  });

  it('should start in an error state if no initial value provided', () => {
    const source$ = atom<number>();
    const a = flow(fromAtom(source$));
    expect(() => a.get()).toThrowError(/Flow has not emitted yet/);
    a.dispose();
  });

  it('should update when the stream emits', async () => {
    const source$ = atom<number>();
    const a = flow(fromAtom(source$));
    const values: number[] = [];
    a.subscribe(v => values.push(v));
    await delay();

    source$.set(1);
    await delay();
    source$.set(2);
    await delay();

    expect(values).toEqual([1, 2]);
    expect(a.get()).toBe(2);
    a.dispose();
  });

  it('should track prior', async () => {
    const source$ = atom<number>();
    const a = flow(fromAtom(source$));
    expect(a.prior).toBeUndefined();

    source$.set(20);
    await delay();
    expect(a.value).toBe(20);
    expect(a.prior).toBeUndefined();

    source$.set(30);
    await delay();
    expect(a.value).toBe(30);
    expect(a.prior).toBe(20);

    a.dispose();
  });

  it('should throw after disposal', () => {
    const source$ = atom<number>();
    const a = flow(fromAtom(source$));
    a.dispose();
    expect(() => a.get()).toThrowError(/disposed/);
  });

  it('should clean up stream subscription on dispose', async () => {
    const source$ = atom<number>();
    const a = flow(fromAtom(source$));
    a.dispose();
    expect(() => source$.set(1)).not.toThrow();
  });
  
  it('should hold an initial value', () => {
    const a = atom('hello');
    expect(a.value).toBe('hello');
    expect(a.prior).toBe('hello');
    a.dispose();
  });

  it('should update via set', () => {
    const a = atom(0);
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.set(10);
    expect(a.value).toBe(10);
    expect(a.prior).toBe(0);
    expect(values).toEqual([10]);

    a.set(20);
    expect(a.value).toBe(20);
    expect(values).toEqual([10, 20]);

    a.dispose();
  });

  it('should emit duplicate values', () => {
    const a = atom(5);
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.set(5);
    a.set(5);
    expect(values).toEqual([5, 5]);

    a.dispose();
  });

  it('should not replay values to late subscribers', () => {
    const a = atom(0);

    a.set(1);
    a.set(2);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([]);
    a.dispose();
  });
});

describe('atom', () => {
  it('should have no initial value', () => {
    const a = atom<number>();
    expect(a.safeValue).toBeUndefined();
    expect(a.error).not.toBeNull();
    a.dispose();
  });

  it('should update via set', () => {
    const a = atom<number>();
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.set(10);
    expect(a.value).toBe(10);
    expect(values).toEqual([10]);

    a.set(20);
    expect(a.value).toBe(20);
    expect(values).toEqual([10, 20]);

    a.dispose();
  });

  it('should emit duplicate values', () => {
    const a = atom<number>();
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.set(5);
    a.set(5);
    expect(values).toEqual([5, 5]);

    a.dispose();
  });

  it('should not replay values to late subscribers', () => {
    const a = atom<number>();

    a.set(1);
    a.set(2);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([]);
    a.dispose();
  });

  it('should track prior after updates', () => {
    const a = atom<number>();

    a.set(10);
    expect(a.prior).toBeUndefined();

    a.set(20);
    expect(a.prior).toBe(10);

    a.set(30);
    expect(a.prior).toBe(20);

    a.dispose();
  });

  it('should clean up subscriptions on dispose', () => {
    const a = atom<number>();
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.set(1);
    a.dispose();
    a.set(2);

    expect(values).toEqual([1]);
  });

  it('should not receive values after unsubscribe', () => {
    const a = atom<number>();
    const values: number[] = [];
    const sub = a.subscribe(v => values.push(v));

    a.set(1);
    sub.unsubscribe();
    a.set(2);

    expect(values).toEqual([1]);
    a.dispose();
  });

  it('should use custom equality to skip duplicate values', () => {
    const a = atom({ id: 1 }, {
      equal: (x, y) => x.id === y.id
    });

    const values: { id: number }[] = [];
    a.subscribe(v => values.push(v));

    a.set({ id: 1, name: 'Ada' }); // equal by id, should be skipped
    a.set({ id: 2, name: 'Grace' }); // different id, should emit

    expect(a.value).toEqual({ id: 2, name: 'Grace' });
    expect(values).toEqual([{ id: 2, name: 'Grace' }]);

    a.dispose();
  });

  it('should recover from error even when equal returns true', () => {
    const a = atom<number>(0, { equal: (x, y) => x === y });
    a.setError(new Error('boom'));

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.set(0); // same value, but error -> value recovery should still happen
    expect(a.value).toBe(0);
    expect(values).toEqual([0]);

    a.dispose();
  });

  it('should throw after atom disposal', () => {
    const a = atom<number>();
    a.dispose();
    expect(() => a.get()).toThrowError(/disposed/);
  });
});

describe('derived', () => {
  it('should compute an initial value', () => {
    const a = atom(2);
    const b = atom(3);
    const sum = derived(() => a.value + b.value);

    expect(sum.value).toBe(5);
    sum.dispose();
  });

  it('should recompute when a dependency changes', () => {
    const a = atom(1);
    const doubled = derived(() => a.value * 2);
    const values: number[] = [];
    doubled.subscribe(v => values.push(v));

    a.set(5);
    expect(doubled.value).toBe(10);
    expect(values).toEqual([10]);

    a.set(7);
    expect(doubled.value).toBe(14);
    expect(values).toEqual([10, 14]);

    doubled.dispose();
  });

  it('should emit duplicate values', () => {
    const a = atom(1);
    const doubled = derived(() => a.value * 2);
    const values: number[] = [];
    doubled.subscribe(v => values.push(v));

    a.set(2);
    a.set(2);
    expect(values).toEqual([4, 4]);

    doubled.dispose();
  });

  it('should track prior', () => {
    const a = atom(10);
    const inc = derived(() => a.value + 1);

    expect(inc.prior).toBe(11);
    a.set(20);
    expect(inc.value).toBe(21);
    expect(inc.prior).toBe(11);

    inc.dispose();
  });

  it('should clean up dependency subscriptions on dispose', () => {
    const a = atom(1);
    const doubled = derived(() => a.value * 2);

    expect(doubled.value).toBe(2); // evaluate before disposal
    doubled.dispose();

    a.set(99);
    expect(doubled.value).toBe(2);
  });

  it('should not evaluate until read', () => {
    let calls = 0;
    const a = atom(1);
    const d = derived(() => {
      calls++;
      return a.value * 2;
    });

    expect(calls).toBe(0);
    expect(d.value).toBe(2);
    expect(calls).toBe(1);

    d.dispose();
  });

  it('should not subscribe to dependencies until read', () => {
    const a = atom(1);
    const d = derived(() => a.value * 2);

    a.set(5);
    expect(d.value).toBe(10); // value reflects latest dependency, not historical emissions

    d.dispose();
  });

  it('should evaluate on subscription', () => {
    let calls = 0;
    const a = atom(1);
    const d = derived(() => {
      calls++;
      return a.value * 2;
    });

    const values: number[] = [];
    d.subscribe(v => values.push(v));

    expect(calls).toBe(1);
    a.set(5);
    expect(values).toEqual([10]);

    d.dispose();
  });

  it('should stay lazy inside a scope until read', () => {
    let calls = 0;
    const a = atom(1);

    const s = scope(() => {
      const d = derived(() => {
        calls++;
        return a.value * 2;
      });
      return { d };
    });

    expect(calls).toBe(0);
    expect(s.d.value).toBe(2);
    expect(calls).toBe(1);

    s.dispose();
  });

  it('should dynamically adjust dependencies', () => {
    const a = atom(1);
    const b = atom(10);
    const useA = atom(true);

    const result = derived(() => useA.value ? a.value : b.value);
    expect(result.value).toBe(1);

    a.set(5);
    expect(result.value).toBe(5);

    b.set(20);
    expect(result.value).toBe(5);

    useA.set(false);
    expect(result.value).toBe(20);

    a.set(99);
    expect(result.value).toBe(20);

    b.set(30);
    expect(result.value).toBe(30);

    result.dispose();
  });

  it('should track dependencies through get()', () => {
    const a = atom(7);
    const result = derived(() => a.get() * 3);

    expect(result.value).toBe(21);
    a.set(4);
    expect(result.value).toBe(12);

    result.dispose();
  });

  it('should handle nested derived atoms', () => {
    const a = atom(3);
    const inner = derived(() => a.value * 2);
    const outer = derived(() => inner.value + 1);

    expect(outer.value).toBe(7);
    a.set(5);
    expect(outer.value).toBe(11);

    outer.dispose();
    inner.dispose();
  });
});