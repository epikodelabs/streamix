import { atom, createSubject } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('atom', () => {
  it('should hold an initial value', () => {
    const subject = createSubject<number>();
    const a = atom(subject, 42);
    expect(a.get()).toBe(42);
    expect(a.value).toBe(42);
    a.dispose();
  });

  it('should update when the stream emits', async () => {
    const subject = createSubject<number>();
    const a = atom(subject, 0);
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

  it('should track previousValue', async () => {
    const subject = createSubject<number>();
    const a = atom(subject, 10);
    expect(a.previousValue).toBe(10);

    subject.next(20);
    await delay();
    expect(a.value).toBe(20);
    expect(a.previousValue).toBe(10);

    subject.next(30);
    await delay();
    expect(a.value).toBe(30);
    expect(a.previousValue).toBe(20);

    a.dispose();
  });

  it('should not emit duplicate values', async () => {
    const subject = createSubject<number>();
    const a = atom(subject, 0);
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
    const subject = createSubject<number>();
    const a = atom(subject, 0);
    a.dispose();
    expect(() => a.get()).toThrowError(/disposed/);
  });

  it('should clean up stream subscription on dispose', async () => {
    const subject = createSubject<number>();
    const a = atom(subject, 0);
    a.dispose();
    expect(() => subject.next(1)).not.toThrow();
  });


});
