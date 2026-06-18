import type { AtomBase } from '@epikodelabs/streamix';
import { concat, flow, DONE, from, iterate, NEXT } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('concat', () => {
  it('should emit values from each source in sequence', async () => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const source = concat(...sources);

    const emittedValues: string[] = [];
    source.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual([
      'source1_value1',
      'source1_value2',
      'source2_value1',
      'source2_value2',
    ]);
  });

  it('should create a concat atom with provided sources', () => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const atom = concat(...sources);

    expect(atom).toBeInstanceOf(Object);
  });

  it('should propagate errors from the source stream', async () => {
    const errorMessage = 'Test error';

    const sources = [
      from([1, 2, 3]), flow(async function* () {
        throw new Error(errorMessage);
      }),
      from([4, 5, 6]),
    ];

    const atom = concat(...sources);

    let caughtError: any = null;

    try {
      for await (const _ of iterate(atom)) {
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

    for await (const value of iterate(concat(promisedSource, regularSource))) {
      if (value !== undefined) values.push(value);
    }

    expect(values).toEqual(['promise-1', 'promise-2', 'regular']);
  });

  it('handles sources whose iterator lacks a return hook', async () => {
    const values: string[] = [];

    const bareIteratorStream = createBareIteratorStream();

    for await (const value of iterate(concat(bareIteratorStream, from(['next'])))) {
      if (value !== undefined) values.push(value);
    }

    expect(values).toEqual(['bare', 'next']);
  });
});

function createBareIteratorStream(): AtomBase<string> {
  const stream = {} as AtomBase<string>;

  (stream as any).type = 'atom';
  (stream as any).name = 'bare-iterator';
  stream[Symbol.asyncIterator] = () => {
    let emitted = false;

    return {
      async next() {
        if (emitted) return DONE;
        emitted = true;
        return NEXT('bare');
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    } as AsyncIterator<string>;
  };

  return stream;
}
