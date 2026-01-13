import type { Stream } from '@epikodelabs/streamix';
import { concat, createStream, createSubscription, from } from '@epikodelabs/streamix';


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

  it('awaits promised sources before emitting', async () => {
    const values: string[] = [];

    const promisedSource = from(['promise-1', 'promise-2']);
    const regularSource = from(['regular']);

    for await (const value of concat(promisedSource, regularSource)) {
      values.push(value);
    }

    expect(values).toEqual(['promise-1', 'promise-2', 'regular']);
  });

  it('handles sources whose iterator lacks a return hook', async () => {
    const values: string[] = [];

    const bareIteratorStream = createBareIteratorStream();

    for await (const value of concat(bareIteratorStream, from(['next']))) {
      values.push(value);
    }

    expect(values).toEqual(['bare', 'next']);
  });
});

function createBareIteratorStream(): Stream<string> {
  const stream = {} as Stream<string>;

  stream.type = 'stream';
  stream.id = 'bare-it';
  stream.name = 'bare-iterator';
  stream.pipe = (() => stream) as any;
  stream.subscribe = () => createSubscription(async () => {});
  stream.query = async () => 'bare';
  stream[Symbol.asyncIterator] = () => {
    let emitted = false;

    return {
      async next() {
        if (emitted) return { done: true, value: undefined };
        emitted = true;
        return { done: false, value: 'bare' };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    } as AsyncIterator<string>;
  };

  return stream;
}


