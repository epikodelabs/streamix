import { concat, createStream, from } from '@actioncrew/streamix';


describe('concat', () => {
  it('should emit values from each source in sequence', (done) => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const concatStream = concat(...sources);

    const emittedValues: any[] = [];
    const subscription = concatStream.subscribe({
      next: (value: any) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([
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

  it('should complete when all sources have emitted', (done) => {
    let isCompleted = false;

    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const concatStream = concat(...sources);
    const subscription = concatStream.subscribe({
      complete: () => {
        isCompleted = true;
        expect(isCompleted).toBe(true);
        subscription.unsubscribe();
        done();
      }
    });
  });

  it('should create a ConcatStream with provided sources', () => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const concatStream = concat(...sources);

    expect(concatStream).toBeInstanceOf(Object);
  });

  it('should propagate errors from the source stream', async () => {
    const errorMessage = 'Test error';
    
    const sources = [
      from([1, 2, 3]), // emits normally
      createStream("errorStream", async function* () {
      throw new Error(errorMessage); // errors immediately
    }),
      from([4, 5, 6]), // should not run
    ];

    const concatenated = concat(...sources);

    let caughtError: any = null;

    try {
      for await (const _ of concatenated) {
        // do nothing, just consume
      }
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeTruthy();
    expect(caughtError.message).toBe(errorMessage);
  });
});
