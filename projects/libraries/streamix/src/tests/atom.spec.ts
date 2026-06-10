import { createSubject, startWith } from '@epikodelabs/streamix';
import { atom, derived, flow, replay } from '../lib/atoms/atom';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('flow', () => {
  it('should hold an initial value when using startWith', async () => {
    const subject = createSubject<number>().pipe(startWith(42));
    const a = flow(subject);
    await delay();
    expect(a.get()).toBe(42);
    expect(a.value).toBe(42);
    a.dispose();
  });

  it('should start in an error state if no initial value provided', () => {
    const subject = createSubject<number>();
    const a = flow(subject);
    expect(() => a.get()).toThrowError(/Flow has not emitted yet/);
    a.dispose();
  });

  it('should update when the stream emits', async () => {
    const subject = createSubject<number>();
    const a = flow(subject);
    const values: number[] = [];
    a.subscribe(v => values.push(v));
    await delay();

    subject.next(1);
    await delay();
    subject.next(2);
    await delay();

    expect(values).toEqual([1, 2]);
    expect(a.get()).toBe(2);
    a.dispose();
  });

  it('should track prior', async () => {
    const subject = createSubject<number>();
    const a = flow(subject);
    expect(a.prior).toBeUndefined();

    subject.next(20);
    await delay();
    expect(a.value).toBe(20);
    expect(a.prior).toBeUndefined();

    subject.next(30);
    await delay();
    expect(a.value).toBe(30);
    expect(a.prior).toBe(20);

    a.dispose();
  });

  it('should emit duplicate values', async () => {
    const subject = createSubject<number>();
    const a = flow(subject);
    const values: number[] = [];
    a.subscribe(v => values.push(v));
    await delay();

    subject.next(0);
    await delay();
    subject.next(0);
    await delay();

    expect(values).toEqual([0, 0]);
    a.dispose();
  });

  it('should throw after disposal', () => {
    const subject = createSubject<number>();
    const a = flow(subject);
    a.dispose();
    expect(() => a.get()).toThrowError(/disposed/);
  });

  it('should clean up stream subscription on dispose', async () => {
    const subject = createSubject<number>();
    const a = flow(subject);
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

  it('should throw after disposal', () => {
    const a = atom(0);
    a.dispose();
    expect(() => a.get()).toThrowError(/disposed/);
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

  it('should throw after disposal', () => {
    const a = atom<number>();
    a.dispose();
    expect(() => a.get()).toThrowError(/disposed/);
  });
});

describe('replay', () => {
  it('should replay last N values to late subscribers', () => {
    const a = replay<number>(3);

    a.set(1);
    a.set(2);
    a.set(3);
    a.set(4);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([2, 3, 4]);
    a.dispose();
  });

  it('should replay all values when fewer than capacity have been pushed', () => {
    const a = replay<number>(5);

    a.set(1);
    a.set(2);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([1, 2]);
    a.dispose();
  });

  it('should replay only last value with capacity 1', () => {
    const a = replay<number>(1);

    a.set(1);
    a.set(2);
    a.set(3);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([3]);
    a.dispose();
  });

  it('should replay initial value to late subscribers', () => {
    const a = replay<number>(2, 99);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([99]);
    a.dispose();
  });

  it('should deliver replayed values then live values in order', () => {
    const a = replay<number>(2);

    a.set(1);
    a.set(2);

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    a.set(3);
    a.set(4);

    expect(values).toEqual([1, 2, 3, 4]);
    a.dispose();
  });

  it('should give different replay windows to subscribers joining at different times', () => {
    const a = replay<number>(2);

    a.set(1);
    a.set(2);

    const early: number[] = [];
    a.subscribe(v => early.push(v));

    a.set(3);

    const late: number[] = [];
    a.subscribe(v => late.push(v));

    a.set(4);

    expect(early).toEqual([1, 2, 3, 4]);
    expect(late).toEqual([2, 3, 4]);
    a.dispose();
  });

  it('should not replay values after dispose', () => {
    const a = replay<number>(3);

    a.set(1);
    a.set(2);
    a.dispose();

    const values: number[] = [];
    a.subscribe(v => values.push(v));

    expect(values).toEqual([]);
  });

  it('should throw on capacity less than 1', () => {
    expect(() => replay(0)).toThrowError(/capacity/);
    expect(() => replay(-1)).toThrowError(/capacity/);
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
    doubled.dispose();

    a.set(99);
    expect(doubled.value).toBe(2);
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