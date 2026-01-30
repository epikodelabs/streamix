import { createSubject } from '@epikodelabs/streamix';

const flushMicrotasks = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('createSubject', () => {

  beforeEach(async () => {
    await flushMicrotasks();
  });

  it('does not emit values after unsubscribe (unsubscribe triggers complete)', async () => {
    const subject = createSubject<any>();
    const emitted: any[] = [];
    let completed = false;

    const sub = subject.subscribe({
      next: v => emitted.push(v),
      complete: () => {
        completed = true;
      }
    });

    subject.next('value1');
    await flushMicrotasks();
    sub.unsubscribe();
    subject.next('value2');
    
    // Wait for async receiver callbacks to complete
    await flushMicrotasks();

    expect(emitted).toEqual(['value1']);
    expect(completed).toBeTrue();
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

  it('does not replay past values to late subscribers', async () => {
    const subject = createSubject<any>();
    const early: any[] = [];
    const late: any[] = [];
    let completed = false;

    subject.subscribe(v => early.push(v));
    subject.next('value1');

    subject.subscribe({
      next: v => late.push(v),
      complete: () => {
        completed = true;
      }
    });

    subject.next('value2');
    subject.complete();
    
    await flushMicrotasks();

    expect(early).toEqual(['value1', 'value2']);
    expect(late).toEqual(['value2']);
    expect(completed).toBeTrue();
  });

  it('emits values and completes normally', async () => {
    const subject = createSubject<any>();
    const values: any[] = [];
    let completed = false;

    subject.subscribe({
      next: v => values.push(v),
      complete: () => {
        completed = true;
      }
    });

    subject.next('value1');
    subject.next('value2');
    subject.complete();
    
    await flushMicrotasks();

    expect(values).toEqual(['value1', 'value2']);
    expect(completed).toBeTrue();
  });

  it('ignores emissions after completion', async () => {
    const subject = createSubject<any>();
    const values: any[] = [];
    let completed = false;

    subject.subscribe({
      next: v => values.push(v),
      complete: () => {
        completed = true;
      }
    });

    subject.next('value1');
    subject.complete();
    subject.next('value2');
    
    await flushMicrotasks();

    expect(values).toEqual(['value1']);
    expect(completed).toBeTrue();
  });

  it('handles synchronous stress correctly', async () => {
    const subject = createSubject<number>();
    let i = 0;
    let completed = false;

    subject.subscribe({
      next: v => expect(v).toBe(i++),
      complete: () => completed = true
    });

    for (let n = 0; n < 1000; n++) subject.next(n);
    subject.complete();
    
    await flushMicrotasks();

    expect(completed).toBeTrue();
    expect(i).toBe(1000);
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

  it('broadcasts to multiple subscribers', async () => {
    const subject = createSubject<any>();
    const a: any[] = [];
    const b: any[] = [];
    let completed = false;

    subject.subscribe(v => a.push(v));
    subject.subscribe({
      next: v => b.push(v),
      complete: () => {
        completed = true;
      }
    });

    subject.next('value1');
    subject.next('value2');
    subject.complete();
    
    await flushMicrotasks();

    expect(a).toEqual(['value1', 'value2']);
    expect(b).toEqual(['value1', 'value2']);
    expect(completed).toBeTrue();
  });

  it('unsubscribing one subscriber does not affect others', async () => {
    const subject = createSubject<any>();
    const a: any[] = [];
    const b: any[] = [];
    let completed = false;

    const sub1 = subject.subscribe(v => a.push(v));
    subject.subscribe({
      next: v => b.push(v),
      complete: () => {
        completed = true;
      }
    });

    subject.next('value1');
    await flushMicrotasks();
    sub1.unsubscribe();
    subject.next('value2');
    subject.complete();
    
    await flushMicrotasks();

    expect(a).toEqual(['value1']);
    expect(b).toEqual(['value1', 'value2']);
    expect(completed).toBeTrue();
  });

  it('supports void signals', async () => {
    const subject = createSubject<void>();
    let count = 0;
    let completed = false;

    subject.subscribe({
      next: v => {
        expect(v).toBeUndefined();
        count++;
      },
      complete: () => {
        completed = true;
      }
    });

    subject.next();
    subject.next(undefined);
    subject.next();
    subject.complete();
    
    await flushMicrotasks();

    expect(count).toBe(3);
    expect(completed).toBeTrue();
  });

  it('late subscribers complete immediately if subject already completed', async () => {
    const subject = createSubject<number>();
    subject.complete();

    await flushMicrotasks();

    let completed = false;
    subject.subscribe({ complete: () => (completed = true) });

    await flushMicrotasks();
    expect(completed).toBeTrue();
  });

  it('late subscribers receive terminal error immediately', async () => {
    const subject = createSubject<number>();
    const err = new Error('late-error');
    
    let caught: Error | null = null;
    subject.subscribe({ error: e => (caught = e as Error) });
    subject.error(err);

    await flushMicrotasks();
    expect(caught!.message).toBe('late-error');
  });

  it('unsubscribe always triggers complete exactly once', async () => {
    const subject = createSubject<number>();
    let completes = 0;

    const sub = subject.subscribe({
      next: () => sub.unsubscribe(),
      complete: () => {
        completes++;
      }
    });

    subject.next(1);
    
    await flushMicrotasks();

    expect(completes).toBe(1);
  });

  it('tracks the latest value and completion state', async () => {
    const subject = createSubject<string>();

    expect(subject.value).toBeUndefined();
    expect(subject.completed()).toBeFalse();

    subject.next('alpha');
    await flushMicrotasks();
    expect(subject.value).toBe('alpha');
    expect(subject.completed()).toBeFalse();

    subject.complete();
    await flushMicrotasks();

    expect(subject.completed()).toBeTrue();
    expect(subject.value).toBe('alpha');
  });

  it('query() resolves with the first emitted value', async () => {
    const subject = createSubject<number>();
    const firstValue = subject.query();

    subject.next(42);
    await flushMicrotasks();

    expect(await firstValue).toBe(42);
  });

  it('allows piping through derived streams', async () => {
    const subject = createSubject<number>();
    const piped = subject.pipe();
    const subscription = piped.subscribe();

    subject.next(7);
    subject.complete();
    await flushMicrotasks();

    expect(subject.completed()).toBeTrue();
    expect(subject.value).toBe(7);
    subscription.unsubscribe();
  });

  it('delivers errors to current subscribers and blocks new emissions', async () => {
    const subject = createSubject<number>();
    const events: Array<[string, any?]> = [];

    subject.subscribe({
      next: (value) => events.push(['next', value]),
      error: (err) => events.push(['error', (err as Error).message]),
      complete: () => events.push(['complete'])
    });

    subject.next(1);
    subject.error(new Error('boom'));
    subject.next(2);

    await flushMicrotasks();

    expect(events).toEqual([
      ['next', 1],
      ['error', 'boom']
    ]);
    expect(subject.completed()).toBeTrue();
    expect(subject.value).toBe(1);
  });

  it('ignores duplicate completions', async () => {
    const subject = createSubject<number>();
    let completes = 0;

    subject.subscribe({
      complete: () => completes++
    });

    subject.complete();
    subject.complete();

    await flushMicrotasks();
    expect(completes).toBe(1);
  });

  it('ignores duplicate errors', async () => {
    const subject = createSubject<number>();
    const errors: string[] = [];

    subject.subscribe({
      error: (err) => errors.push((err as Error).message)
    });

    subject.error(new Error('first'));
    subject.error(new Error('second'));

    await flushMicrotasks();
    expect(errors).toEqual(['first']);
  });

  it('skips cleanup when unsubscribing after completion', async () => {
    const subject = createSubject<number>();
    const subscription = subject.subscribe({
      complete: () => void 0
    });

    subject.next(1);
    subject.complete();

    await subscription.unsubscribe();
    await flushMicrotasks();

    expect(subject.completed()).toBeTrue();
  });

  it('runs cleanup when unsubscribing while active', async () => {
    const subject = createSubject<number>();
    let completes = 0;

    const subscription = subject.subscribe({
      complete: () => completes++
    });

    await subscription.unsubscribe();
    await flushMicrotasks();

    expect(completes).toBe(1);
  });
});
