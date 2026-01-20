import { createBehaviorSubject } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('createBehaviorSubject', () => {
  it('emits the latest value to every subscriber while honoring unsubscriptions', async () => {
    const subject = createBehaviorSubject<number>(0);
    const valuesA: number[] = [];
    const valuesB: number[] = [];

    subject.subscribe(v => valuesA.push(v));
    subject.next(1);
    await delay();

    const subB = subject.subscribe(v => valuesB.push(v));
    await delay();

    subject.next(2);
    await delay();

    expect(valuesA).toEqual([0, 1, 2]);
    expect(valuesB).toEqual([1, 2]);

    const lateValues: number[] = [];
    subject.subscribe(v => lateValues.push(v));
    await delay();
    expect(lateValues).toEqual([2]);

    const resubValues: number[] = [];
    const resub = subject.subscribe(v => resubValues.push(v));
    subject.next(3);
    await delay();
    resub.unsubscribe();

    subject.next(4);
    await delay();

    expect(resubValues).toEqual([2, 3]);

    const finalValues: number[] = [];
    subject.subscribe(v => finalValues.push(v));
    await delay();
    subject.next(5);
    await delay();
    expect(finalValues).toEqual([4, 5]);

    subB.unsubscribe();
    subject.next(6);
    await delay();
    expect(valuesA[valuesA.length - 1]).toBe(6);

    const immediateSubject = createBehaviorSubject<number>(10);
    const immediateReceived: number[] = [];
    const immediateSub = immediateSubject.subscribe(v => immediateReceived.push(v));
    immediateSub.unsubscribe();
    immediateSubject.next(11);
    await delay();
    expect(immediateReceived).toEqual([10]);
  });

  it('enforces completion and error semantics while exposing terminal state', async () => {
    const completeSubject = createBehaviorSubject<number>(0);
    const delivered: number[] = [];
    let completions = 0;
    completeSubject.subscribe({
      next: v => delivered.push(v),
      complete: () => completions++
    });

    completeSubject.next(1);
    completeSubject.complete();
    completeSubject.next(2);
    await delay();

    expect(delivered).toEqual([0, 1]);
    expect(completions).toBe(1);
    expect(completeSubject.completed()).toBeTrue();

    let lateComplete = false;
    completeSubject.subscribe({
      next: () => { throw new Error('should not receive next'); },
      complete: () => { lateComplete = true; }
    });
    await delay();
    expect(lateComplete).toBeTrue();

    expect(() => completeSubject.error(new Error('ignored'))).not.toThrow();
    expect(completeSubject.completed()).toBeTrue();

    const errorSubject = createBehaviorSubject<number>(0);
    const errorValues: number[] = [];
    let caughtError: Error | null = null;
    errorSubject.subscribe({
      next: v => errorValues.push(v),
      error: e => caughtError = e as Error
    });

    errorSubject.next(1);
    errorSubject.error('boom');
    errorSubject.next(2);
    await delay();

    expect(errorValues).toEqual([0, 1]);
    expect(caughtError).toEqual(jasmine.any(Error));
    expect(caughtError!.message).toBe('boom');
    expect(errorSubject.completed()).toBeTrue();

    let lateError: any | null = null;
    errorSubject.subscribe({
      next: () => {},
      error: e => lateError = e as Error
    });
    await delay();
    expect(lateError?.message).toBe('boom');

    const numericErrorSubject = createBehaviorSubject<number>(0);
    let numericError: Error | null = null;
    numericErrorSubject.subscribe({ error: e => numericError = e as Error });
    numericErrorSubject.error(404);
    await delay();
    expect(numericError).toBeInstanceOf(Error);
    expect(numericError!.message).toBe('404');

    const afterErrorSubject = createBehaviorSubject<number>(0);
    let completionCount = 0;
    afterErrorSubject.subscribe({ complete: () => completionCount++ });
    afterErrorSubject.error(new Error('boom'));
    afterErrorSubject.complete();
    await delay();
    expect(completionCount).toBe(1);
  });

  it('exposes value getter, query, observer, and iterator helpers consistently', async () => {
    const getterSubject = createBehaviorSubject<number>(0);
    expect(getterSubject.value).toBe(0);
    getterSubject.next(1);
    expect(getterSubject.value).toBe(1);
    getterSubject.next(2);
    expect(getterSubject.value).toBe(2);
    getterSubject.complete();
    expect(getterSubject.value).toBe(2);

    const descriptor = Object.getOwnPropertyDescriptor(getterSubject, 'value');
    expect(descriptor).toBeDefined();
    expect(typeof descriptor?.get).toBe('function');

    const multiAccessSubject = createBehaviorSubject<number>(42);
    const v1 = multiAccessSubject.value;
    const v2 = multiAccessSubject.value;
    expect(v1).toBe(42);
    expect(v2).toBe(42);

    const querySubject = createBehaviorSubject<number>(10);
    expect(await querySubject.query()).toBe(10);
    querySubject.next(20);
    expect(await querySubject.query()).toBe(20);
    querySubject.next(30);
    expect(await querySubject.query()).toBe(30);

    await delay();
    const queryValues: number[] = [];
    querySubject.subscribe(v => queryValues.push(v));
    querySubject.next(40);
    await delay();
    expect(queryValues).toEqual([30, 40]);

    const observerEvents: string[] = [];
    const observerSubject = createBehaviorSubject<number>(0);
    observerSubject.subscribe({
      next: v => observerEvents.push(`next:${v}`),
      error: e => observerEvents.push(`error:${(e as Error).message}`),
      complete: () => observerEvents.push('complete')
    });
    observerSubject.next(1);
    observerSubject.next(2);
    observerSubject.complete();
    await delay();
    expect(observerEvents).toEqual(['next:0', 'next:1', 'next:2', 'complete']);

    const callbackSubject = createBehaviorSubject<number>(0);
    const callbackValues: number[] = [];
    callbackSubject.subscribe(v => callbackValues.push(v));
    callbackSubject.next(1);
    callbackSubject.complete();
    await delay();
    expect(callbackValues).toEqual([0, 1]);

    const partialSubject = createBehaviorSubject<number>(0);
    const partialValues: number[] = [];
    partialSubject.subscribe({
      next: v => partialValues.push(v),
      complete: () => partialValues.push(-1)
    });
    partialSubject.next(1);
    partialSubject.complete();
    await delay();
    expect(partialValues).toEqual([0, 1, -1]);

    const iteratorSubject = createBehaviorSubject<number>(0);
    const iterValues: number[] = [];
    const iteratorRunner = (async () => {
      for await (const value of iteratorSubject) {
        iterValues.push(value);
        if (iterValues.length === 3) break;
      }
    })();
    iteratorSubject.next(1);
    iteratorSubject.next(2);
    await iteratorRunner;
    expect(iterValues).toEqual([0, 1, 2]);

    const iteratorCompleteSubject = createBehaviorSubject<number>(0);
    const iterValues2: number[] = [];
    const iteratorRunner2 = (async () => {
      for await (const value of iteratorCompleteSubject) {
        iterValues2.push(value);
      }
    })();
    iteratorCompleteSubject.next(1);
    iteratorCompleteSubject.complete();
    await iteratorRunner2;
    expect(iterValues2).toEqual([0, 1]);

    const iteratorBreakSubject = createBehaviorSubject<number>(0);
    const iterValues3: number[] = [];
    const iteratorRunner3 = (async () => {
      for await (const value of iteratorBreakSubject) {
        iterValues3.push(value);
        if (value === 1) break;
      }
    })();
    iteratorBreakSubject.next(1);
    iteratorBreakSubject.next(2);
    await iteratorRunner3;
    expect(iterValues3).toEqual([0, 1]);
  });

  it('accepts diverse value shapes and complex type usages', async () => {
    const scenarios = [
      {
        label: 'undefined',
        initial: undefined as number | undefined,
        next: [42, undefined],
        expected: [undefined, 42, undefined],
        final: undefined
      },
      {
        label: 'null',
        initial: null as string | null,
        next: ['value', null],
        expected: [null, 'value', null],
        final: null
      },
      {
        label: 'object',
        initial: { id: 1 },
        next: [{ id: 2 }, { id: 3 }],
        expected: [{ id: 1 }, { id: 2 }, { id: 3 }],
        final: { id: 3 }
      },
      {
        label: 'array',
        initial: [1, 2] as number[],
        next: [[3, 4], []],
        expected: [[1, 2], [3, 4], []],
        final: []
      },
      {
        label: 'boolean',
        initial: false,
        next: [true, false, true],
        expected: [false, true, false, true],
        final: true
      },
      {
        label: 'zero',
        initial: 0,
        next: [1, 0, -1],
        expected: [0, 1, 0, -1],
        final: -1
      },
      {
        label: 'empty-string',
        initial: '',
        next: ['text', ''],
        expected: ['', 'text', ''],
        final: ''
      }
    ];

    for (const scenario of scenarios) {
      const subject = createBehaviorSubject<typeof scenario.initial>(scenario.initial);
      const values: typeof scenario.initial[] = [];
      subject.subscribe(v => values.push(v));
      for (const next of scenario.next) {
        subject.next(next as typeof scenario.initial);
      }
      await delay();
      expect(values).toEqual(scenario.expected);
      expect(subject.value).toEqual(scenario.final);
    }

    interface User {
      id: number;
      name: string;
    }

    const complexSubject = createBehaviorSubject<User>({ id: 1, name: 'Alice' });
    const complexValues: User[] = [];
    complexSubject.subscribe(v => complexValues.push(v));
    complexSubject.next({ id: 2, name: 'Bob' });
    complexSubject.next({ id: 3, name: 'Charlie' });
    await delay();
    expect(complexValues).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' }
    ]);

    const unionSubject = createBehaviorSubject<string | number>('start');
    const unionValues: (string | number)[] = [];
    unionSubject.subscribe(v => unionValues.push(v));
    unionSubject.next(99);
    unionSubject.next('end');
    await delay();
    expect(unionValues).toEqual(['start', 99, 'end']);

    type Maybe<T> = T | null | undefined;
    const optionalSubject = createBehaviorSubject<Maybe<string>>(null);
    expect(optionalSubject.value).toBeNull();
    optionalSubject.next(undefined);
    expect(optionalSubject.value).toBeUndefined();
    optionalSubject.next('final');
    expect(optionalSubject.value).toBe('final');
  });

  it('survives subscription churn and high-volume emissions', async () => {
    const churnSubject = createBehaviorSubject<number>(0);
    for (let i = 0; i < 10; i++) {
      const sub = churnSubject.subscribe(() => {});
      churnSubject.next(i + 1);
      sub.unsubscribe();
    }
    await delay();
    expect(churnSubject.value).toBe(10);

    const onceSubject = createBehaviorSubject<number>(0);
    const onceValues: number[] = [];
    let onceSubscription: any = null;
    onceSubscription = onceSubject.subscribe(v => {
      onceValues.push(v);
      if (v === 1) {
        onceSubscription.unsubscribe();
      }
    });
    await delay();
    onceSubject.next(1);
    await delay();
    onceSubject.next(2);
    await delay();
    expect(onceValues).toEqual([0, 1]);

    const idleSubject = createBehaviorSubject<number>(0);
    const idleSubs = Array.from({ length: 3 }, () => idleSubject.subscribe(() => {}));
    idleSubs.forEach(sub => sub.unsubscribe());
    idleSubject.next(1);
    await delay();
    const idleValues: number[] = [];
    idleSubject.subscribe(v => idleValues.push(v));
    await delay();
    expect(idleValues).toEqual([1]);

    const heavySubject = createBehaviorSubject<number>(0);
    const heavyValues: number[] = [];
    heavySubject.subscribe(v => heavyValues.push(v));
    const emissionCount = 500;
    for (let i = 1; i <= emissionCount; i++) {
      heavySubject.next(i);
    }
    await delay(50);
    expect(heavyValues.length).toBe(emissionCount + 1);
    expect(heavyValues[0]).toBe(0);
    expect(heavyValues[heavyValues.length - 1]).toBe(emissionCount);
  });
});
