import { createSubject, distinctUntilKeyChanged, iterate, pipe, type Subject } from '@epikodelabs/streamix';

describe('distinctUntilKeyChanged', () => {
  let subject: Subject<any>;

  beforeEach(() => {
    subject = createSubject<any>();
  });

  it('should emit values with distinct keys', async () => {
    const atom = pipe(subject, distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next({ key: 1, value: 'a' });
    subject.next({ key: 1, value: 'b' });
    subject.next({ key: 2, value: 'c' });
    subject.next({ key: 2, value: 'd' });
    subject.next({ key: 3, value: 'e' });
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([
      { key: 1, value: 'a' },
      { key: 2, value: 'c' },
      { key: 3, value: 'e' },
    ]);
  });

  it('should emit the first value regardless of key', async () => {
    const atom = pipe(subject, distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next({ key: 1, value: 'a' });
    subject.next({ key: 1, value: 'b' });
    subject.next({ key: 1, value: 'c' });
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([{ key: 1, value: 'a' }]);
  });

  it('should handle an empty stream gracefully', async () => {
    const atom = pipe(subject, distinctUntilKeyChanged('key'));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([]);
  });

  it('should propagate errors from the source stream', async () => {
    const atom = pipe(subject, distinctUntilKeyChanged('key'));
    let error: any = null;

    const consumptionPromise = (async () => {
      try {
        for await (const _ of iterate(atom)) {
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
    const atom = pipe(subject, distinctUntilKeyChanged(Promise.resolve('key')));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
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
    const atom = pipe(subject, distinctUntilKeyChanged('key', comparator));
    const results: any[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
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
