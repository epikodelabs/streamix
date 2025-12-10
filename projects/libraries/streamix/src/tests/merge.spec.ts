import { from, merge } from '@actioncrew/streamix';

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
});

