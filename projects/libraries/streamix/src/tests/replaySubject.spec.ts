import { createReplaySubject, createSemaphore } from '@epikodelabs/streamix';

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

const shortDelay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('createSemaphore', () => {
  it('should acquire immediately if permits are available', async () => {
    const sem = createSemaphore(2);

    const release1 = await sem.acquire();
    const release2 = await sem.acquire();

    expect(release1).toBeInstanceOf(Function);
    expect(release2).toBeInstanceOf(Function);
  });

  it('should return null on tryAcquire if no permits are available', () => {
    const sem = createSemaphore(1);

    const r1 = sem.tryAcquire();
    const r2 = sem.tryAcquire();

    expect(r1).not.toBeNull();
    expect(r2).toBeNull();
  });

  it('should wait for permit if none available', async () => {
    const sem = createSemaphore(1);

    const release1 = await sem.acquire();
    let acquired = false;

    sem.acquire().then((release2) => {
      acquired = true;
      release2();
    });

    // Give a small delay to allow promise to attempt acquisition
    await new Promise((r) => setTimeout(r, 20));
    expect(acquired).toBeFalse();

    release1(); // release the first permit
    await new Promise((r) => setTimeout(r, 20));
    expect(acquired).toBeTrue();
  });

  it('should unblock multiple waiting acquire calls in order', async () => {
    const sem = createSemaphore(1);

    const order: number[] = [];

    const r1 = await sem.acquire();
    const p2 = sem.acquire().then((r) => {
      order.push(2);
      r();
    });
    const p3 = sem.acquire().then((r) => {
      order.push(3);
      r();
    });

    order.push(1);

    r1(); // release first
    await p2; // wait for second acquire to finish
    expect(order).toEqual([1, 2]);

    await p3; // wait for third acquire to finish
    expect(order).toEqual([1, 2, 3]);
  });

  it('tryAcquire should acquire permit if available after release', () => {
    const sem = createSemaphore(1);

    const r1 = sem.tryAcquire();
    expect(r1).not.toBeNull();

    r1!(); // release the permit
    const r2 = sem.tryAcquire();
    expect(r2).not.toBeNull();
  });

  it('release without waiting acquirers should increase available permits', async () => {
    const sem = createSemaphore(1);

    const r1 = sem.tryAcquire();
    expect(r1).not.toBeNull();

    r1!(); // release
    const r2 = sem.tryAcquire();
    expect(r2).not.toBeNull();
  });

  it('should handle concurrent acquire/release correctly', async () => {
    const sem = createSemaphore(2);
    const results: number[] = [];

    const p1 = sem.acquire().then((r) => {
      results.push(1);
      r();
    });
    const p2 = sem.acquire().then((r) => {
      results.push(2);
      r();
    });
    const p3 = sem.acquire().then((r) => {
      results.push(3);
      r();
    });

    await Promise.all([p1, p2, p3]);
    expect(results).toEqual([1, 2, 3]);
  });
});

describe('createReplaySubject', () => {
  it('replays buffered values and delivers live emissions while respecting unsubscriptions', async () => {
    const subject = createReplaySubject<number>(2);

    subject.next(1);
    subject.next(2);

    const primary: number[] = [];
    const late: number[] = [];

    const primarySub = subject.subscribe(v => primary.push(v));
    await waitFor(() => primary.length === 2);

    subject.next(3);
    await waitFor(() => primary.length === 3);

    const lateSub = subject.subscribe(v => late.push(v));
    await waitFor(() => late.length === 2);

    subject.next(4);
    await waitFor(() => primary.length === 4 && late.length === 3);

    primarySub.unsubscribe();
    lateSub.unsubscribe();

    subject.next(5);

    const after: number[] = [];
    const afterSub = subject.subscribe(v => after.push(v));
    await waitFor(() => after.length === 2);
    expect(after.slice(0, 2)).toEqual([4, 5]);

    subject.next(6);
    await waitFor(() => after.length === 3);

    expect(primary).toEqual([1, 2, 3, 4]);
    expect(late).toEqual([2, 3, 4]);
    expect(after).toEqual([4, 5, 6]);

    afterSub.unsubscribe();
  });

  it('enforces buffer sizing rules while preserving diverse value shapes', async () => {
    const zero = createReplaySubject<number>(0);
    zero.next(1);
    zero.next(2);
    zero.next(3);
    const zeroValues: number[] = [];
    const zeroSub = zero.subscribe(v => zeroValues.push(v));
    zero.next(4);
    await waitFor(() => zeroValues.length === 1);
    expect(zeroValues).toEqual([4]);
    zeroSub.unsubscribe();

    const limited = createReplaySubject<number>(3);
    for (let i = 1; i <= 6; i++) {
      limited.next(i);
    }
    const limitedValues: number[] = [];
    const limitedSub = limited.subscribe(v => limitedValues.push(v));
    await waitFor(() => limitedValues.length === 3);
    expect(limitedValues).toEqual([4, 5, 6]);
    limitedSub.unsubscribe();

    const unlimited = createReplaySubject<number>();
    for (let i = 1; i <= 10; i++) {
      unlimited.next(i);
    }
    const unlimitedValues: number[] = [];
    const unlimitedSub = unlimited.subscribe(v => unlimitedValues.push(v));
    await waitFor(() => unlimitedValues.length === 10);
    expect(unlimitedValues[0]).toBe(1);
    expect(unlimitedValues[9]).toBe(10);
    unlimitedSub.unsubscribe();

    const maintained = createReplaySubject<number>(2);
    maintained.next(7);
    maintained.next(8);
    maintained.next(9);
    const maintainedValues1: number[] = [];
    const maintainedSub1 = maintained.subscribe(v => maintainedValues1.push(v));
    await waitFor(() => maintainedValues1.length === 2);
    maintainedSub1.unsubscribe();
    maintained.next(10);
    const maintainedValues2: number[] = [];
    const maintainedSub2 = maintained.subscribe(v => maintainedValues2.push(v));
    await waitFor(() => maintainedValues2.length === 2);
    expect(maintainedValues1).toEqual([8, 9]);
    expect(maintainedValues2).toEqual([9, 10]);
    maintainedSub2.unsubscribe();

    const undefinedSubject = createReplaySubject<number | undefined>(2);
    undefinedSubject.next(1);
    undefinedSubject.next(undefined);
    undefinedSubject.next(2);
    const undefinedValues: (number | undefined)[] = [];
    const undefinedSub = undefinedSubject.subscribe(v => undefinedValues.push(v));
    await waitFor(() => undefinedValues.length === 2);
    expect(undefinedValues).toEqual([undefined, 2]);
    undefinedSub.unsubscribe();

    const nullSubject = createReplaySubject<string | null>(2);
    nullSubject.next('a');
    nullSubject.next(null);
    nullSubject.next('b');
    const nullValues: (string | null)[] = [];
    const nullSub = nullSubject.subscribe(v => nullValues.push(v));
    await waitFor(() => nullValues.length === 2);
    expect(nullValues).toEqual([null, 'b']);
    nullSub.unsubscribe();

    const objectSubject = createReplaySubject<{ id: number }>(2);
    const first = { id: 1 };
    const second = { id: 2 };
    objectSubject.next(first);
    objectSubject.next(second);
    objectSubject.next({ id: 3 });
    const objectValues: { id: number }[] = [];
    const objectSub = objectSubject.subscribe(v => objectValues.push(v));
    await waitFor(() => objectValues.length === 2);
    expect(objectValues[0]).toBe(second);
    objectSub.unsubscribe();

    const rapidSubject = createReplaySubject<number>(5);
    for (let i = 0; i < 100; i++) {
      rapidSubject.next(i);
    }
    const rapidValues: number[] = [];
    const rapidSub = rapidSubject.subscribe(v => rapidValues.push(v));
    await waitFor(() => rapidValues.length === 5);
    expect(rapidValues).toEqual([95, 96, 97, 98, 99]);
    rapidSub.unsubscribe();

    const emptyBufferSubject = createReplaySubject<number>(5);
    const emptyValues: number[] = [];
    const emptySub = emptyBufferSubject.subscribe(v => emptyValues.push(v));
    await shortDelay();
    emptyBufferSubject.next(1);
    await waitFor(() => emptyValues.length === 1);
    expect(emptyValues).toEqual([1]);
    emptySub.unsubscribe();
  });

  it('replays buffered values after asynchronous receivers resolve', async () => {
    const subject = createReplaySubject<number>(2);
    subject.next(1);
    subject.next(2);

    const received: number[] = [];
    let finishFirst: (() => void) | null = null;

    const sub = subject.subscribe({
      next(value) {
        received.push(value);
        if (value === 1) {
          return new Promise<void>((resolve) => {
            finishFirst = resolve;
          });
        }
        return Promise.resolve();
      },
      complete() {}
    });

    await waitFor(() => received.length === 1);
    expect(finishFirst).toBeDefined();
    finishFirst!();
    await waitFor(() => received.length === 2);
    expect(received).toEqual([1, 2]);

    sub.unsubscribe();
  });

  it('terminates active and late subscribers through completion and error signals', async () => {
    const completeSubject = createReplaySubject<number>(2);
    const completion: (number | 'complete')[] = [];
    completeSubject.subscribe({
      next: v => completion.push(v),
      complete: () => completion.push('complete')
    });
    completeSubject.next(1);
    completeSubject.next(2);
    completeSubject.complete();
    await waitFor(() => completion.includes('complete'));
    expect(completion).toEqual([1, 2, 'complete']);
    completeSubject.next(3);
    await shortDelay();
    expect(completion).toEqual([1, 2, 'complete']);

    const lateValues: number[] = [];
    let lateComplete = false;
    completeSubject.subscribe({
      next: v => lateValues.push(v),
      complete: () => { lateComplete = true; }
    });
    await waitFor(() => lateComplete);
    expect(lateValues).toEqual([1, 2]);

    const errorSubject = createReplaySubject<number>(2);
    const errors: Error[] = [];
    errorSubject.subscribe({ error: e => errors.push(e as Error) });
    errorSubject.next(4);
    errorSubject.error('failure');
    await shortDelay();
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('failure');
    expect(errorSubject.completed()).toBeTrue();

    let lateError: any | null = null;
    errorSubject.subscribe({
      next: () => {},
      error: e => lateError = e as Error
    });
    await waitFor(() => Boolean(lateError));
    expect(lateError?.message).toBe('failure');

    const afterErrorSubject = createReplaySubject<number>(2);
    let completeAfterError = 0;
    afterErrorSubject.subscribe({
      complete: () => completeAfterError++,
      error: () => {}
    });
    afterErrorSubject.error(new Error('boom'));
    afterErrorSubject.complete();
    await shortDelay();
    expect(completeAfterError).toBe(0);
  });

  it('supports query, async iterator, observer, and type-safe helpers', async () => {
    const getter = createReplaySubject<number>(3);
    expect(getter.value).toBeUndefined();
    getter.next(1);
    expect(getter.value).toBe(1);
    getter.next(2);
    getter.next(3);
    expect(getter.value).toBe(3);
    getter.complete();
    expect(getter.value).toBe(3);
    expect(getter.completed()).toBeTrue();

    const queryBuilder = createReplaySubject<number>(2);
    queryBuilder.next(5);
    expect(await queryBuilder.query()).toBe(5);
    expect(await queryBuilder.query()).toBe(5);

    const liveQuery = createReplaySubject<number>(2);
    setTimeout(() => liveQuery.next(42), 5);
    expect(await liveQuery.query()).toBe(42);

    const iteratorSubject = createReplaySubject<number>(3);
    iteratorSubject.next(1);
    iteratorSubject.next(2);
    const iteratorValues: number[] = [];
    const iteratorRunner = (async () => {
      for await (const value of iteratorSubject) {
        iteratorValues.push(value);
        if (iteratorValues.length === 3) break;
      }
    })();
    iteratorSubject.next(3);
    await iteratorRunner;
    expect(iteratorValues).toEqual([1, 2, 3]);

    const iteratorCompleteSubject = createReplaySubject<number>(2);
    const iteratorCompleteValues: number[] = [];
    const iteratorRunner2 = (async () => {
      for await (const value of iteratorCompleteSubject) {
        iteratorCompleteValues.push(value);
      }
    })();
    iteratorCompleteSubject.next(1);
    iteratorCompleteSubject.complete();
    await iteratorRunner2;
    expect(iteratorCompleteValues).toEqual([1]);

    const observerEvents: string[] = [];
    const observerSubject = createReplaySubject<number>(2);
    observerSubject.next(1);
    observerSubject.subscribe({
      next: v => observerEvents.push(`next:${v}`),
      error: e => observerEvents.push(`error:${(e as Error).message}`),
      complete: () => observerEvents.push('complete')
    });
    observerSubject.next(2);
    observerSubject.complete();
    await waitFor(() => observerEvents.length === 3);
    expect(observerEvents).toEqual(['next:1', 'next:2', 'complete']);

    const callbackSubject = createReplaySubject<number>(2);
    callbackSubject.next(1);
    const callbackValues: number[] = [];
    callbackSubject.subscribe(v => callbackValues.push(v));
    callbackSubject.next(2);
    await waitFor(() => callbackValues.length === 2);
    expect(callbackValues).toEqual([1, 2]);

    interface Payload {
      id: number;
      text: string;
    }

    const typeSubject = createReplaySubject<Payload>(2);
    typeSubject.next({ id: 1, text: 'a' });
    typeSubject.next({ id: 2, text: 'b' });
    const typeValues: Payload[] = [];
    const typeSub = typeSubject.subscribe(v => typeValues.push(v));
    await waitFor(() => typeValues.length === 2);
    expect(typeValues).toEqual([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' }
    ]);
    typeSub.unsubscribe();

    const unionSubject = createReplaySubject<string | number>(2);
    unionSubject.next('a');
    unionSubject.next(1);
    const unionValues: (string | number)[] = [];
    const unionSub = unionSubject.subscribe(v => unionValues.push(v));
    await waitFor(() => unionValues.length === 2);
    expect(unionValues).toEqual(['a', 1]);
    unionSub.unsubscribe();

    const completedIndicator = createReplaySubject<number>(2);
    expect(completedIndicator.completed()).toBeFalse();
    completedIndicator.error(new Error('done'));
    await shortDelay();
    expect(completedIndicator.completed()).toBeTrue();
  });

  it('manages lifecycle, asynchronous replay, and performance pressure', async () => {
    const replaySubject = createReplaySubject<number>(5);
    for (let i = 1; i <= 5; i++) {
      replaySubject.next(i);
    }
    const replayValues: number[] = [];
    let replaySub: any = null;
    replaySub = replaySubject.subscribe(v => {
      replayValues.push(v);
      if (v === 3) {
        replaySub.unsubscribe();
      }
    });
    await shortDelay();
    expect(replayValues.length).toBeLessThanOrEqual(3);

    const liveSubject = createReplaySubject<number>(2);
    const liveValues: number[] = [];
    let liveSub: any = null;
    liveSub = liveSubject.subscribe(v => {
      liveValues.push(v);
      if (v === 2) {
        liveSub.unsubscribe();
      }
    });
    liveSubject.next(1);
    liveSubject.next(2);
    liveSubject.next(3);
    await shortDelay();
    expect(liveValues).toEqual([1, 2]);

    const resubject = createReplaySubject<number>(2);
    resubject.next(1);
    resubject.next(2);
    const firstValues: number[] = [];
    const firstSub = resubject.subscribe(v => firstValues.push(v));
    await waitFor(() => firstValues.length === 2);
    firstSub.unsubscribe();
    resubject.next(3);
    const secondValues: number[] = [];
    const secondSub = resubject.subscribe(v => secondValues.push(v));
    await waitFor(() => secondValues.length === 2);
    expect(firstValues).toEqual([1, 2]);
    expect(secondValues).toEqual([2, 3]);
    secondSub.unsubscribe();

    const perfSubject = createReplaySubject<number>(5);
    for (let i = 1; i <= 200; i++) {
      perfSubject.next(i);
    }
    const perfValues: number[] = [];
    const perfSub = perfSubject.subscribe(v => perfValues.push(v));
    await waitFor(() => perfValues.length === 5);
    expect(perfValues).toEqual([196, 197, 198, 199, 200]);
    perfSub.unsubscribe();

    const churnSubject = createReplaySubject<number>(3);
    churnSubject.next(1);
    churnSubject.next(2);
    churnSubject.next(3);
    for (let i = 0; i < 50; i++) {
      const sub = churnSubject.subscribe(() => {});
      sub.unsubscribe();
    }
    const churnValues: number[] = [];
    const churnSub = churnSubject.subscribe(v => churnValues.push(v));
    await waitFor(() => churnValues.length === 3);
    expect(churnValues).toEqual([1, 2, 3]);
    churnSub.unsubscribe();

    const alternating = createReplaySubject<number>(2);
    for (let i = 1; i <= 10; i++) {
      alternating.next(i);
      const snapshot: number[] = [];
      const tempSub = alternating.subscribe(v => snapshot.push(v));
      await waitFor(() => snapshot.length >= Math.min(2, i));
      tempSub.unsubscribe();
      expect(snapshot[snapshot.length - 1]).toBe(i);
    }

    const asyncSubject = createReplaySubject<number>(3);
    asyncSubject.next(1);
    asyncSubject.next(2);
    const asyncValues: number[] = [];
    asyncSubject.subscribe({
      next(v) {
        if (v === 1) {
          return new Promise<void>(resolve => setTimeout(() => {
            asyncValues.push(v);
            resolve();
          }, 20));
        }
        asyncValues.push(v);
        return Promise.resolve();
      }
    });
    await shortDelay(60);
    expect(asyncValues).toEqual([1, 2]);

    const completingReceiver = createReplaySubject<number>(3);
    completingReceiver.next(1);
    completingReceiver.next(2);
    const completingValues: number[] = [];
    const receiver: any = {
      completed: false,
      next(v: number) {
        if (!this.completed) {
          completingValues.push(v);
        }
        if (v === 1) {
          this.complete();
        }
      },
      complete() {
        this.completed = true;
      },
      error() {}
    };
    completingReceiver.subscribe(receiver);
    await shortDelay(20);
    completingReceiver.next(3);
    await shortDelay(20);
    expect(completingValues).toEqual([1]);
  });
});

describe('createReplaySubjectExtended', () => {
  it('applies extended buffer semantics and default parameters', async () => {
    const zero = createReplaySubject<number>(0);
    zero.next(1);
    zero.next(2);
    const zeroRecorded: number[] = [];
    const zeroSub = zero.subscribe(v => zeroRecorded.push(v));
    zero.next(3);
    await waitFor(() => zeroRecorded.length === 1);
    expect(zeroRecorded).toEqual([3]);
    zeroSub.unsubscribe();

    const limited = createReplaySubject<number>(3);
    for (let i = 1; i <= 5; i++) {
      limited.next(i);
    }
    const limitedRecorded: number[] = [];
    const limitedSub = limited.subscribe(v => limitedRecorded.push(v));
    await waitFor(() => limitedRecorded.length === 3);
    expect(limitedRecorded).toEqual([3, 4, 5]);
    limitedSub.unsubscribe();

    const infinite = createReplaySubject<number>();
    for (let i = 1; i <= 20; i++) {
      infinite.next(i);
    }
    const infiniteRecorded: number[] = [];
    const infiniteSub = infinite.subscribe(v => infiniteRecorded.push(v));
    await waitFor(() => infiniteRecorded.length === 20);
    expect(infiniteRecorded[0]).toBe(1);
    expect(infiniteRecorded[19]).toBe(20);
    infiniteSub.unsubscribe();

    const persistent = createReplaySubject<number>(2);
    persistent.next(1);
    persistent.next(2);
    persistent.next(3);
    const persistentValues1: number[] = [];
    const persistentSub1 = persistent.subscribe(v => persistentValues1.push(v));
    await waitFor(() => persistentValues1.length === 2);
    persistentSub1.unsubscribe();
    persistent.next(4);
    const persistentValues2: number[] = [];
    const persistentSub2 = persistent.subscribe(v => persistentValues2.push(v));
    await waitFor(() => persistentValues2.length === 2);
    expect(persistentValues1).toEqual([2, 3]);
    expect(persistentValues2).toEqual([3, 4]);
    persistentSub2.unsubscribe();

    const edgeSubject = createReplaySubject<string | null>(2);
    edgeSubject.next('alpha');
    edgeSubject.next(null);
    const edgeValues: (string | null)[] = [];
    const edgeSub = edgeSubject.subscribe(v => edgeValues.push(v));
    await waitFor(() => edgeValues.length === 2);
    expect(edgeValues).toEqual(['alpha', null]);
    edgeSub.unsubscribe();
  });

  it('should maintain order when new values arrive during replay delivery', async () => {
    const subject = createReplaySubject<string>(10);
    subject.next('A');
    subject.next('B');
    subject.next('C');

    const received: string[] = [];
    
    let releasePause: (() => void) | null = null;

    // Create a slow receiver that pauses on the first value
    const sub = subject.subscribe({
      next: async (val) => {
        received.push(val);
        if (val === 'A') {
          await new Promise<void>(r => releasePause = r);
        }
      }
    });

    // Ensure we started receiving
    await waitFor(() => received.length >= 1);
    expect(received).toContain('A');

    // Emit a new value while the receiver is paused handling 'A'
    subject.next('D');

    // Let the receiver continue
    releasePause!();

    await waitFor(() => received.length >= 4);

    // Expected: A, B, C, D
    expect(received).toEqual(['A', 'B', 'C', 'D']);
    sub.unsubscribe();
  });
});
