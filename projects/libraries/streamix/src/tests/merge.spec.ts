import {flow, from, iterate, merge} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('merge', () => {
  it('should merge values from multiple sources', async () => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const atom = merge(...sources);

    const emittedValues: string[] = [];
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues.sort()).toEqual([
      'source1_value1',
      'source1_value2',
      'source2_value1',
      'source2_value2',
    ]);
  });

  it('should emit values from all sources', async () => {
    const sources = [
      from(['source1_value1', 'source1_value2']),
      from(['source2_value1', 'source2_value2']),
    ];

    const atom = merge(...sources);

    let subscriptionCalls = 0;
    atom.subscribe(() => subscriptionCalls++);
    await delay();

    expect(subscriptionCalls).toBe(4);
  });

  it('should merge promise-based sources and resolve arrays', async () => {
    const sources = [
      from(['stream-value']),
      Promise.resolve('promise-value'),
    ];

    const atom = merge(...sources);
    const emitted: string[] = [];

    atom.subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay();

    expect(emitted.sort()).toEqual(['promise-value', 'stream-value']);
  });

  it('should propagate errors from rejected sources', async () => {
    const badSource = flow(async function* () {
      throw new Error('boom');
    });

    const atom = merge(badSource, from([1]));

    let caught: any;
    try {
      for await (const v of iterate(atom)) {
        void v;
      }
    } catch (e) {
      caught = e;
    }

    expect(caught.message).toBe('boom');
  });

  it('should emit ready values without waiting for every source to emit first', async () => {
    const never: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return: async () => ({ done: true, value: undefined as any }),
        };
      }
    };
    const iterator = iterate(merge(from([1]), never))[Symbol.asyncIterator]();

    const first = await Promise.race([
      iterator.next(),
      delay(50).then(() => ({ done: true as const, value: -1 }))
    ]);

    void iterator.return?.();

    expect(first.done).toBeFalse();
    expect(first.value).toBe(1);
  });

  it('should emit nothing immediately when no sources are provided', async () => {
    const atom = merge();
    const emitted: any[] = [];

    atom.subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay();

    expect(emitted).toEqual([]);
  });

  it('cleans up underlying iterators when the consumer stops early', async () => {
    const cleanupCalls: number[] = [];

    const makeSource = (id: number) =>
      flow(async function* () {
        try {
          while (true) {
            yield id;
          }
        } finally {
          cleanupCalls.push(id);
        }
      });

    const merged = merge(makeSource(1), makeSource(2));
    const iterator = iterate(merged)[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBeFalse();

    await iterator.return!(undefined);
    await delay(20);

    expect(cleanupCalls).toContain(1);
    expect(cleanupCalls).toContain(2);
  });
});
