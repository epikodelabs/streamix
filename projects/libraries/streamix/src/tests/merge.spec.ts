import { createStream, from, merge } from '@epikodelabs/streamix';

describe('merge', () => {
  it('should merge values from multiple sources', (done) => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const mergeStream = merge(...sources);

    const emittedValues: any[] = [];
    const subscription = mergeStream.subscribe({
      next: (value: any) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues.sort()).toEqual([
          'source1_value1',
          'source1_value2',
          'source2_value1',
          'source2_value2',
        ]);

        subscription.unsubscribe();
        done();
      }
    });
  });

  it('should complete when all sources complete', (done) => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const mergeStream = merge(...sources);

    let subscriptionCalls = 0;

    mergeStream.subscribe({
      next: () => subscriptionCalls++,
      complete: () => {
        expect(subscriptionCalls).toBe(4);
        done();
      }
    })
  });

  it('should merge promise-based sources and resolve arrays', (done) => {
    const sources = [
      from(['stream-value']),
      Promise.resolve('promise-value'),
    ];

    const merged = merge(...sources);
    const emitted: string[] = [];

    merged.subscribe({
      next: (value) => emitted.push(value),
      complete: () => {
        expect(emitted.sort()).toEqual(['promise-value', 'stream-value']);
        done();
      },
      error: () => done.fail('should not error'),
    });
  });

  it('should propagate errors from rejected sources', (done) => {
    const badStream = createStream('error', async function* () {
      throw new Error('boom');
    });

    const merged = merge(badStream, from([1]));

    merged.subscribe({
      next: () => done.fail('unexpected next'),
      error: (error: Error) => {
        expect(error.message).toBe('boom');
        done();
      },
    });
  });

  it('should complete immediately when no sources are provided', (done) => {
    const merged = merge();
    let emitted = false;

    merged.subscribe({
      next: () => {
        emitted = true;
      },
      complete: () => {
        expect(emitted).toBe(false);
        done();
      },
      error: () => done.fail('should not error'),
    });
  });
});
