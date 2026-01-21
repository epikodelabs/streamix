import { createSubject, distinctUntilKeyChanged, type Stream } from '@epikodelabs/streamix';

describe('distinctUntilKeyChanged', () => {
  let subject: ReturnType<typeof createSubject<any>>;
  let source: Stream<any>;

  beforeEach(() => {
    subject = createSubject<any>();
    source = subject;
  });

  it('should emit values with distinct keys', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    subject.next({ key: 1, value: 'a' });
    subject.next({ key: 1, value: 'b' }); // same key, skip
    subject.next({ key: 2, value: 'c' }); // new key, emit
    subject.next({ key: 2, value: 'd' }); // same key, skip
    subject.next({ key: 3, value: 'e' }); // new key, emit
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 1, value: 'a' },
      { key: 2, value: 'c' },
      { key: 3, value: 'e' },
    ]);
  });

  it('should emit the first value regardless of key', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    subject.next({ key: 1, value: 'a' }); // emit
    subject.next({ key: 1, value: 'b' }); // same key, skip
    subject.next({ key: 1, value: 'c' }); // same key, skip
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 1, value: 'a' },
    ]);
  });

  it('should handle an empty stream gracefully', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([]);
  });

  it('should propagate errors from the source stream', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged('key'));
    let error: any = null;

    const consumptionPromise = (async () => {
      try {
        for await (const _ of distinctStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.error(new Error('Test Error'));

    await consumptionPromise;

    expect(error).toEqual(new Error('Test Error'));
  });

  it('should resolve promised keys before filtering values', async () => {
    const distinctStream = source.pipe(distinctUntilKeyChanged(Promise.resolve('key')));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    subject.next({ key: 1, value: 'a' });
    subject.next({ key: 1, value: 'b' });
    subject.next({ key: 2, value: 'c' });
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 1, value: 'a' },
      { key: 2, value: 'c' },
    ]);
  });

  it('should work with promise-based comparators', async () => {
    const comparator = (prev: number, curr: number) => Promise.resolve(prev === curr);
    const distinctStream = source.pipe(distinctUntilKeyChanged('key', comparator));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of distinctStream) {
        results.push(value);
      }
    })();

    subject.next({ key: 5, value: 'first' });
    subject.next({ key: 5, value: 'skip' });
    subject.next({ key: 6, value: 'second' });
    subject.next({ key: 6, value: 'skip again' });
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 5, value: 'first' },
      { key: 6, value: 'second' },
    ]);
  });
});


