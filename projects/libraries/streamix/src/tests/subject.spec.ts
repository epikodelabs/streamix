import { createSubject } from '@epikodelabs/streamix';

const flushMicrotasks = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('createSubject', () => {

  it('does not emit values after unsubscribe (unsubscribe triggers complete)', (done) => {
    const subject = createSubject<any>();
    const emitted: any[] = [];

    const sub = subject.subscribe({
      next: v => emitted.push(v),
      complete: () => {
        expect(emitted).toEqual(['value1']);
        done();
      }
    });

    subject.next('value1');
    sub.unsubscribe();
    subject.next('value2');
  });

  it('does not emit if unsubscribed before any delivery', async () => {
    const subject = createSubject<number>();
    const values: number[] = [];

    const sub = subject.subscribe(v => values.push(v));
    sub.unsubscribe();

    subject.next(1);
    subject.complete();

    await flushMicrotasks();
    expect(values).toEqual([]);
  });

  it('supports independent subscriptions with different lifetimes', async () => {
    const subject = createSubject<any>();
    const a: any[] = [];
    const b: any[] = [];

    const sub1 = subject.subscribe(v => a.push(v));

    subject.next('value1');

    const sub2 = subject.subscribe({
      next: v => b.push(v)
    });

    subject.next('value2');
    subject.next('value3');
    subject.next('value4');
    await flushMicrotasks();

    sub1.unsubscribe();
    subject.complete();
    await flushMicrotasks();

    expect(a).toEqual(['value1', 'value2', 'value3', 'value4']);
    expect(b).toEqual(['value2', 'value3', 'value4']);
    sub2.unsubscribe();
  });

  it('does not replay past values to late subscribers', (done) => {
    const subject = createSubject<any>();
    const early: any[] = [];
    const late: any[] = [];

    subject.subscribe(v => early.push(v));
    subject.next('value1');

    subject.subscribe({
      next: v => late.push(v),
      complete: () => {
        expect(early).toEqual(['value1', 'value2']);
        expect(late).toEqual(['value2']);
        done();
      }
    });

    subject.next('value2');
    subject.complete();
  });

  it('emits values and completes normally', (done) => {
    const subject = createSubject<any>();
    const values: any[] = [];

    subject.subscribe({
      next: v => values.push(v),
      complete: () => {
        expect(values).toEqual(['value1', 'value2']);
        done();
      }
    });

    subject.next('value1');
    subject.next('value2');
    subject.complete();
  });

  it('ignores emissions after completion', (done) => {
    const subject = createSubject<any>();
    const values: any[] = [];

    subject.subscribe({
      next: v => values.push(v),
      complete: () => {
        expect(values).toEqual(['value1']);
        done();
      }
    });

    subject.next('value1');
    subject.complete();
    subject.next('value2');
  });

  it('handles synchronous stress correctly', (done) => {
    const subject = createSubject<number>();
    let i = 0;

    subject.subscribe({
      next: v => expect(v).toBe(i++),
      complete: done
    });

    for (let n = 0; n < 1000; n++) subject.next(n);
    subject.complete();
  });

  it('handles asynchronous delivery correctly', async () => {
    const subject = createSubject<number>();
    let count = 0;
    let completed = false;

    subject.subscribe({
      next: v => expect(v).toBe(count++),
      complete: () => (completed = true)
    });

    for (let i = 0; i < 1000; i++) subject.next(i);
    subject.complete();

    await flushMicrotasks();
    expect(completed).toBeTrue();
    expect(count).toBe(1000);
  });

  it('broadcasts to multiple subscribers', (done) => {
    const subject = createSubject<any>();
    const a: any[] = [];
    const b: any[] = [];

    subject.subscribe(v => a.push(v));
    subject.subscribe({
      next: v => b.push(v),
      complete: () => {
        expect(a).toEqual(['value1', 'value2']);
        expect(b).toEqual(['value1', 'value2']);
        done();
      }
    });

    subject.next('value1');
    subject.next('value2');
    subject.complete();
  });

  it('unsubscribing one subscriber does not affect others', (done) => {
    const subject = createSubject<any>();
    const a: any[] = [];
    const b: any[] = [];

    const sub1 = subject.subscribe(v => a.push(v));
    subject.subscribe({
      next: v => b.push(v),
      complete: () => {
        expect(a).toEqual(['value1']);
        expect(b).toEqual(['value1', 'value2']);
        done();
      }
    });

    subject.next('value1');
    sub1.unsubscribe();
    subject.next('value2');
    subject.complete();
  });

  it('supports void signals', (done) => {
    const subject = createSubject<void>();
    let count = 0;

    subject.subscribe({
      next: v => {
        expect(v).toBeUndefined();
        count++;
      },
      complete: () => {
        expect(count).toBe(3);
        done();
      }
    });

    subject.next();
    subject.next(undefined);
    subject.next();
    subject.complete();
  });

  it('late subscribers complete immediately if subject already completed', async () => {
    const subject = createSubject<number>();
    subject.complete();

    await flushMicrotasks();

    let completed = false;
    subject.subscribe({ complete: () => (completed = true) });

    await Promise.resolve();
    expect(completed).toBeTrue();
  });

  it('late subscribers receive terminal error immediately', async () => {
    const subject = createSubject<number>();
    const err = new Error('late-error');
    subject.error(err);

    await Promise.resolve();

    let caught: Error | null = null;
    subject.subscribe({ error: e => (caught = e as Error) });

    await Promise.resolve();
    expect(caught!.message).toBe('late-error');
  });

  it('unsubscribe always triggers complete exactly once', (done) => {
    const subject = createSubject<number>();
    let completes = 0;

    const sub = subject.subscribe({
      next: () => sub.unsubscribe(),
      complete: () => {
        completes++;
        expect(completes).toBe(1);
        done();
      }
    });

    subject.next(1);
  });
});
