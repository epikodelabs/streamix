import { createBehaviorSubject } from '@epikodelabs/streamix';

describe('createBehaviorSubject', () => {
  it('should emit the current value to new subscribers immediately', (done) => {
    const initialValue = 'initial_value';
    const behaviorSubject = createBehaviorSubject(initialValue);

    const emittedValues: string[] = [];

    behaviorSubject.subscribe({
      next: (value: string) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([initialValue, 'value1', 'value2']);
        done();
      }
    });

    behaviorSubject.next('value1');
    behaviorSubject.next('value2');
    behaviorSubject.complete();
  });

  it('should not emit values after an immediate unsubscribe', async () => {
    const subject = createBehaviorSubject<number>(1);
    const values: number[] = [];

    const sub = subject.subscribe(value => values.push(value));
    sub.unsubscribe();

    subject.next(2);
    subject.complete();

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(values).toEqual([1]);
  });

  it('should always expose the latest value via the value getter', () => {
    const initial = 42;
    const behaviorSubject = createBehaviorSubject(initial);

    expect(behaviorSubject.value).toBe(42);

    behaviorSubject.next(100);
    expect(behaviorSubject.value).toBe(100);

    behaviorSubject.next(999);
    expect(behaviorSubject.value).toBe(999);

    behaviorSubject.complete();
    expect(behaviorSubject.value).toBe(999);
  });

  it('should always define value on the subject (getter present and readable)', () => {
    const subject = createBehaviorSubject<number>(1);

    expect('value' in subject).toBeTrue();

    const descriptor = Object.getOwnPropertyDescriptor(subject, 'value');
    expect(descriptor).toBeDefined();
    expect(descriptor?.get).toEqual(jasmine.any(Function));

    expect(subject.value).toBe(1);

    subject.next(0);
    // value updates synchronously (even though emissions are scheduled)
    expect(subject.value).toBe(0);

    subject.complete();
    expect(subject.value).toBe(0);
  });

  it('should allow multiple subscribers to receive the same latest value', async () => {
    const subject = createBehaviorSubject<number>(0);

    const valuesA: number[] = [];
    const valuesB: number[] = [];

    subject.subscribe(v => valuesA.push(v));
    subject.subscribe(v => valuesB.push(v));

    subject.next(1);
    subject.next(2);

    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(valuesA).toEqual([0, 1, 2]);
    expect(valuesB).toEqual([0, 1, 2]);
  });

  it('should not emit values after completion', async () => {
    const subject = createBehaviorSubject<string>('init');

    const values: string[] = [];
    subject.subscribe(v => values.push(v));

    subject.next('a');
    subject.complete();
    subject.next('b'); // should be ignored

    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(values).toEqual(['init', 'a']);
  });

  it('should allow late subscribers to still receive the last value', async () => {
    const subject = createBehaviorSubject<number>(123);

    subject.next(456);

    // Wait for the next to process
    await new Promise(resolve => setTimeout(resolve, 10));

    const values: number[] = [];
    subject.subscribe(v => values.push(v));

    // Wait for subscription to process
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(values).toEqual([456]);
  });

  it('late subscribers should complete immediately after completion without emitting', async () => {
    const subject = createBehaviorSubject<number>(10);
    subject.next(20);
    subject.complete();

    await new Promise(resolve => setTimeout(resolve, 0));

    const values: number[] = [];
    let completed = false;

    subject.subscribe({
      next: v => values.push(v),
      complete: () => {
        completed = true;
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(values).toEqual([]);
    expect(completed).toBeTrue();
  });

  it('should support unsubscribe and stop receiving further values', async () => {
    const subject = createBehaviorSubject<number>(0);

    const values: number[] = [];
    const sub = subject.subscribe(v => values.push(v));

    subject.next(1);

    // Wait for value to be processed
    await new Promise(resolve => setTimeout(resolve, 10));

    sub.unsubscribe();
    subject.next(2); // should not be received

    // Wait a bit more to ensure no further values
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(values).toEqual([0, 1]);
  });

  it('should emit error and stop further emissions when errored', async () => {
    const subject = createBehaviorSubject<number>(0);

    const values: number[] = [];
    let caughtError: any = null;

    subject.subscribe({
      next: v => values.push(v),
      error: e => caughtError = e
    });

    subject.next(1);
    subject.error(new Error('boom!'));
    subject.next(2); // ignored

    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(values).toEqual([0, 1]);
    expect(caughtError).toEqual(jasmine.any(Error));
    expect((caughtError as Error).message).toBe('boom!');
  });

  it('should support query() to get the latest value without subscribing', async () => {
    const subject = createBehaviorSubject<number>(10);
    expect(await subject.query()).toBe(10);

    subject.next(20);
    expect(await subject.query()).toBe(20);

    subject.next(30);
    expect(await subject.query()).toBe(30);
    subject.complete();
  });
});



