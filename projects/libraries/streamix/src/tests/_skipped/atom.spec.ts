import { atom, derived, flow } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('flow', () => {
  it('should hold an initial value', () => {
    const subject = atom<number>();
    const a = flow(subject, 42);
    expect(a.value).toBe(42);
    a.dispose();
  });

  it('should update when the stream emits', async () => {
    const subject = atom<number>();
    const a = flow(subject, 0);
    const values: number[] = [];
    a.subscribe(v => values.push(v));
    await delay();

    subject.next(1);
    await delay();
    subject.next(2);
    await delay();

    expect(values).toEqual([1, 2]);
    expect(a.value).toBe(2);
    a.dispose();
  });

  it('should track prior', async () => {
    const subject = atom<number>();
    const a = flow(subject, 10);
    expect(a.prior).toBe(10);

    subject.next(20);
    await delay();
    expect(a.value).toBe(20);
    expect(a.prior).toBe(10);

    subject.next(30);
    await delay();
    expect(a.value).toBe(30);
    expect(a.prior).toBe(20);

    a.dispose();
  });

  it('should not emit duplicate values', async () => {
    const subject = atom<number>();
    const a = flow(subject, 0);
    const values: number[] = [];
    a.subscribe(v => values.push(v));
    await delay();

    subject.next(0);
    await delay();
    subject.next(0);
    await delay();

    expect(values).toEqual([]);
    a.dispose();
  });

  it('should throw after disposal', () => {
    const subject = atom<number>();
    const a = flow(subject, 0);
    a.dispose();
    expect(() => a.value).toThrowError(/disposed/);
  });

  it('should clean up stream subscription on dispose', async () => {
    const subject = atom<number>();
    const a = flow(subject, 0);
    a.dispose();
    expect(() => subject.next(1)).not.toThrow();
  });
});

describe('atom', () => {
  it('should hold an initial value', () => {
    const a = atom('hello');
    expect(a.value).toBe('hello');
    expect(a.prior).toBe('hello');
    a.dispose();
  });

  it('should update via next', () => {
    const a = atom(0);
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.next(10);
    expect(a.value).toBe(10);
    expect(a.prior).toBe(0);
    expect(values).toEqual([10]);

    a.next(20);
    expect(a.value).toBe(20);
    expect(values).toEqual([10, 20]);

    a.dispose();
  });

  it('should suppress duplicate values', () => {
    const a = atom(5);
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.next(5);
    a.next(5);
    expect(values).toEqual([]);

    a.dispose();
  });

  it('should throw after disposal', () => {
    const a = atom(0);
    a.dispose();
    expect(() => a.value).toThrowError(/disposed/);
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

    a.next(5);
    expect(doubled.value).toBe(10);
    expect(values).toEqual([10]);

    a.next(7);
    expect(doubled.value).toBe(14);
    expect(values).toEqual([10, 14]);

    doubled.dispose();
  });

  it('should suppress duplicate values', () => {
    const a = atom(1);
    const doubled = derived(() => a.value * 2);
    const values: number[] = [];
    doubled.subscribe(v => values.push(v));

    a.next(2);
    a.next(2); // same underlying value, derived result unchanged
    expect(values).toEqual([4]);

    doubled.dispose();
  });

  it('should track prior', () => {
    const a = atom(10);
    const inc = derived(() => a.value + 1);

    expect(inc.prior).toBe(11);
    a.next(20);
    expect(inc.value).toBe(21);
    expect(inc.prior).toBe(11);

    inc.dispose();
  });

  it('should clean up dependency subscriptions on dispose', () => {
    const a = atom(1);
    const doubled = derived(() => a.value * 2);
    doubled.dispose();

    // Should not throw or affect the derived after disposal
    a.next(99);
    expect(doubled.safeValue).toBe(2);
    expect(() => doubled.value).toThrowError();
  });

  it('should dynamically adjust dependencies', () => {
    const a = atom(1);
    const b = atom(10);
    const useA = atom(true);

    const result = derived(() => useA.value ? a.value : b.value);
    expect(result.value).toBe(1);

    a.next(5);
    expect(result.value).toBe(5);

    b.next(20);
    expect(result.value).toBe(5); // still using a

    useA.next(false);
    expect(result.value).toBe(20);

    a.next(99);
    expect(result.value).toBe(20); // no longer using a

    b.next(30);
    expect(result.value).toBe(30);

    result.dispose();
  });

  it('should track dependencies through get()', () => {
    const a = atom(7);
    const result = derived(() => a.value * 3);

    expect(result.value).toBe(21);
    a.next(4);
    expect(result.value).toBe(12);

    result.dispose();
  });

  it('should handle nested derived atoms', () => {
    const a = atom(3);
    const inner = derived(() => a.value * 2);
    const outer = derived(() => inner.value + 1);

    expect(outer.value).toBe(7);
    a.next(5);
    expect(outer.value).toBe(11);

    outer.dispose();
    inner.dispose();
  });
});

describe('atom', () => {
  it('should have no initial value', () => {
    const a = atom<number>();
    expect(a.value).toBeUndefined();
    expect(a.prior).toBeUndefined();
    a.dispose();
  });

  it('should update via next', () => {
    const a = atom<number>();
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.next(10);
    expect(a.value).toBe(10);
    expect(a.prior).toBeUndefined();
    expect(values).toEqual([10]);

    a.next(20);
    expect(a.value).toBe(20);
    expect(values).toEqual([10, 20]);

    a.dispose();
  });

  it('should suppress duplicate values', () => {
    const a = atom<number>();
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.next(5);
    a.next(5);
    expect(values).toEqual([5]);

    a.dispose();
  });

  it('should throw after disposal', () => {
    const a = atom<number>();
    a.dispose();
    expect(() => a.value).toThrowError(/disposed/);
  });

  it('should not replay values to late subscribers by default', () => {
    const a = atom<number>();

    a.next(1);
    a.next(2);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([]);
    a.dispose();
  });

  it('should track prior after updates', () => {
    const a = atom<number>();

    a.next(10);
    expect(a.prior).toBeUndefined();

    a.next(20);
    expect(a.prior).toBe(10);

    a.next(30);
    expect(a.prior).toBe(20);

    a.dispose();
  });

  it('should clean up subscriptions on dispose', () => {
    const a = atom<number>();
    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.next(1);
    a.dispose();

    // Should not throw when nextting after disposal
    a.next(2);
    expect(values).toEqual([1]);
  });

  it('should not receive values after unsubscribe', () => {
    const a = atom<number>();
    const values: number[] = [];
    const sub = a.subscribe(v => values.push(v));

    a.next(1);
    sub.unsubscribe();
    a.next(2);

    expect(values).toEqual([1]);
    a.dispose();
  });
});
