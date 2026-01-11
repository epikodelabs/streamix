import { createSubject, type Subscription } from '@epikodelabs/streamix';

describe('createSubject', () => {
  it('should not emit values after unsubscribed', (done) => {
    const subject = createSubject<any>();

    const emittedValues: any[] = [];
    const subscription = subject.subscribe({
      next: value => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(['value1']);
        done();
      }
    });

    subject.next('value1');
    subscription.unsubscribe();
    subject.next('value2');
  });

  it('should not emit when unsubscribed before attachment completes', async () => {
    const subject = createSubject<number>();
    const values: number[] = [];

    const sub = subject.subscribe(value => values.push(value));
    sub.unsubscribe();

    subject.next(1);
    subject.complete();

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(values).toEqual([]);
  });

  it('should allow independent subscriptions with different lifetimes', (done) => {
    const subject = createSubject<any>();

    let emitted1: any[] = [];
    let emitted2: any[] = [];

    const subscription1 = subject.subscribe({
      next: value => emitted1.push(value),
    });

    subject.next('value1');

    const subscription2 = subject.subscribe({
      next: value => emitted2.push(value),
      complete: () => {
        expect(emitted1).toEqual(['value1', 'value2', 'value3', 'value4']);
        expect(emitted2).toEqual(['value2', 'value3', 'value4']); // Late subscriber misses 'value1'
        subscription1.unsubscribe();
        subscription2.unsubscribe();
        done();
      }
    });

    subject.next('value2');
    subject.next('value3');
    subject.next('value4');
    subscription1.unsubscribe(); // Unsubscribing should not affect subscription2
    subject.complete();
  });

  it('should not send past values to late subscribers', (done) => {
    const subject = createSubject<any>();

    const emittedValues1: any[] = [];
    const emittedValues2: any[] = [];

    const subscription1 = subject.subscribe({
      next: value => emittedValues1.push(value),
    });

    subject.next('value1');

    const subscription2 = subject.subscribe({
      next: value => emittedValues2.push(value),
      complete: () => {
        expect(emittedValues1).toEqual(['value1', 'value2']);
        expect(emittedValues2).toEqual(['value2']); // Only gets value2
        subscription1.unsubscribe();
        subscription2.unsubscribe();
        done();
      }
    });

    subject.next('value2');
    subject.complete();
  });

  it('should emit values to subscribers', (done) => {
    const subject = createSubject<any>();

    const emittedValues: any[] = [];
    const subscription: Subscription = subject.subscribe({
      next: value => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(['value1', 'value2']);
        subscription.unsubscribe();
        done();
      }
    });

    subject.next('value1');
    subject.next('value2');
    subject.complete();
  });

  it('should clear emission queue on cancel', (done) => {
    const subject = createSubject<any>();

    const emittedValues: any[] = [];
    const subscription = subject.subscribe({
      next: value => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(['value1']);
        subscription.unsubscribe();
        done();
      }
    });

    subject.next('value1');
    subject.complete();
    subject.next('value2');
  });

  it('stress test, synchronous case', (done) => {
    const subject = createSubject<any>();

    let counter = 0;
    const subscription = subject.subscribe({
      next: value => expect(value === counter++).toBeTruthy(),
      complete: () => {
        subscription.unsubscribe();
        done();
      }
    });

    for (let i = 0; i < 1000; i++) {
      subject.next(i);
    }

    subject.complete();
  });

  it('stress test, asynchronous case', async () => {
    const subject = createSubject<number>();
    let counter = 0;
    let completed = false;

    const subscription = subject.subscribe({
      next: value => {
        expect(value).toBe(counter++);
      },
      complete: () => {
        completed = true;
        subscription.unsubscribe();
      }
    });

    // Send 1000 values
    for (let i = 0; i < 1000; i++) {
      subject.next(i);
    }

    subject.complete();

    // Wait for completion to be processed
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(completed).toBe(true);
    expect(counter).toBe(1000);
  });

  it('should emit values to multiple subscribers', (done) => {
    const subject = createSubject<any>();

    const emittedValues1: any[] = [];
    const emittedValues2: any[] = [];

    const subscription1 = subject.subscribe({
      next: value => emittedValues1.push(value),
    });

    const subscription2 = subject.subscribe({
      next: value => emittedValues2.push(value),
      complete: () => {
        expect(emittedValues1).toEqual(['value1', 'value2']);
        expect(emittedValues2).toEqual(['value1', 'value2']);
        subscription1.unsubscribe();
        subscription2.unsubscribe();
        done();
      }
    });

    subject.next('value1');
    subject.next('value2');

    subject.complete();
  });

  it('should allow one subscription to unsubscribe without affecting others', (done) => {
    const subject = createSubject<any>();

    const emittedValues1: any[] = [];
    const emittedValues2: any[] = [];

    const subscription1 = subject.subscribe({
      next: value => emittedValues1.push(value),
    });

    const subscription2 = subject.subscribe({
      next: value => emittedValues2.push(value),
      complete: () => {
        expect(emittedValues1).toEqual(['value1']);
        expect(emittedValues2).toEqual(['value1', 'value2']);
        subscription2.unsubscribe();
        done();
      }
    });

    subject.next('value1');
    subscription1.unsubscribe();
    subject.next('value2');
    subject.complete();
  });

  it('should handle multiple subscribers in a stress test', (done) => {
    const subject = createSubject<any>();

    let counter1 = 0, counter2 = 0;
    const subscription1 = subject.subscribe({
      next: value => expect(value === counter1++).toBeTruthy(),
    });

    const subscription2 = subject.subscribe({
      next: value => expect(value === counter2++).toBeTruthy(),
      complete: () => {
        subscription1.unsubscribe();
        subscription2.unsubscribe();
        done();
      }
    });

    for (let i = 0; i < 1000; i++) {
      subject.next(i);
    }

    subject.complete();
  });

  it('should handle void subjects (signals without data)', (done) => {
    const subject = createSubject<void>();

    let nextCallCount = 0;
    let completedCallCount = 0;

    const subscription = subject.subscribe({
      next: (value) => {
        expect(value).toBeUndefined();
        nextCallCount++;
      },
      complete: () => {
        completedCallCount++;
        expect(nextCallCount).toBe(3);
        expect(completedCallCount).toBe(1);
        subscription.unsubscribe();
        done();
      }
    });

    // For void subjects, we call next() without arguments or with undefined
    subject.next();
    subject.next(undefined);
    subject.next();

    subject.complete();
  });

  it('should handle void subjects with multiple subscribers', (done) => {
    const subject = createSubject<void>();

    let subscriber1Calls = 0;
    let subscriber2Calls = 0;
    let completionCount = 0;

    const subscription1 = subject.subscribe({
      next: () => subscriber1Calls++,
      complete: () => {
        completionCount++;
        if (completionCount === 2) {
          expect(subscriber1Calls).toBe(2);
          expect(subscriber2Calls).toBe(2);
          subscription1.unsubscribe();
          subscription2.unsubscribe();
          done();
        }
      }
    });

    const subscription2 = subject.subscribe({
      next: () => subscriber2Calls++,
      complete: () => {
        completionCount++;
        if (completionCount === 2) {
          expect(subscriber1Calls).toBe(2);
          expect(subscriber2Calls).toBe(2);
          subscription1.unsubscribe();
          subscription2.unsubscribe();
          done();
        }
      }
    });

    // Signal twice
    subject.next();
    subject.next();
    subject.complete();
  });

  it('should handle void subject unsubscription correctly', (done) => {
    const subject = createSubject<void>();

    let subscriber1Calls = 0;
    let subscriber2Calls = 0;

    const subscription1 = subject.subscribe({
      next: () => subscriber1Calls++
    });

    const subscription2 = subject.subscribe({
      next: () => subscriber2Calls++,
      complete: () => {
        expect(subscriber1Calls).toBe(1); // Only received first signal
        expect(subscriber2Calls).toBe(2); // Received both signals
        subscription2.unsubscribe();
        done();
      }
    });

    subject.next(); // Both subscribers get this
    subscription1.unsubscribe(); // Unsubscribe first subscriber
    subject.next(); // Only subscriber2 gets this
    subject.complete();
  });

  it('late subscribers should complete immediately after completion', async () => {
    const subject = createSubject<number>();
    subject.next(1);
    subject.complete();

    await new Promise(resolve => setTimeout(resolve, 0));

    const values: number[] = [];
    let completed = false;
    subject.subscribe({
      next: value => values.push(value),
      complete: () => {
        completed = true;
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(values).toEqual([]);
    expect(completed).toBeTrue();
  });

  it('late subscribers should receive terminal errors', async () => {
    const subject = createSubject<number>();
    const err = new Error('late-error');
    subject.error(err);

    await new Promise(resolve => setTimeout(resolve, 0));

    const values: number[] = [];
    let caught: Error | null = null;

    subject.subscribe({
      next: value => values.push(value),
      error: e => {
        caught = e as Error;
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(values).toEqual([]);
    expect((caught as any)?.message).toBe('late-error');
  });

  it('calls complete on unsubscribe for cleanup', (done) => {
    const subject = createSubject<number>();
    let completeCalls = 0;
    let subscription: Subscription;

    subscription = subject.subscribe({
      next: () => {
        subscription.unsubscribe();
      },
      complete: () => {
        completeCalls++;
        setTimeout(() => {
          expect(completeCalls).toBe(1);
          done();
        }, 0);
      }
    });

    subject.next(1);
  });
});


