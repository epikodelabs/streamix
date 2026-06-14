import { createStream, iterate, partition, pipe, atom } from '@epikodelabs/streamix';

describe('partition', () => {

  async function collect<T>(source: any): Promise<{ true: T[]; false: T[] }> {
    const trueValues: T[] = [];
    const falseValues: T[] = [];

    for await (const { key, value } of iterate(source) as AsyncIterable<{ key: string; value: T }>) {
      if (key === "true") {
        trueValues.push(value);
      } else {
        falseValues.push(value);
      }
    }

    return { true: trueValues, false: falseValues };
  }

  it('should split values based on predicate', async () => {
    const source = createStream<number>("source", async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
    });

    const partitioned = pipe(source, partition(n => n % 2 === 0));
    const { true: evens, false: odds } = await collect<number>(partitioned);

    expect(evens).toEqual([2, 4]);
    expect(odds).toEqual([1, 3]);
  });

  it('should handle empty source stream', async () => {
    const source = createStream<number>("test", async function* () {});

    const partitioned = pipe(source, partition(() => true));
    const { true: yes, false: no } = await collect<number>(partitioned);

    expect(yes).toEqual([]);
    expect(no).toEqual([]);
  });

  it('should handle all passing the predicate', async () => {
    const source = createStream<number>("test", async function* () {
      yield 1;
      yield 2;
    });

    const partitioned = pipe(source, partition(n => n > 0));
    const { true: pass, false: fail } = await collect<number>(partitioned);

    expect(pass).toEqual([1, 2]);
    expect(fail).toEqual([]);
  });

  it('should handle all failing the predicate', async () => {
    const source = createStream<number>("test", async function* () {
      yield -1;
      yield -2;
    });

    const partitioned = pipe(source, partition(n => n > 0));
    const { true: pass, false: fail } = await collect<number>(partitioned);

    expect(pass).toEqual([]);
    expect(fail).toEqual([-1, -2]);
  });

  it('should propagate errors from source', async () => {
    const source = createStream<number>("test", async function* () {
      yield 1;
      yield 2;
      throw new Error('Test error');
    });

    const partitioned = pipe(source, partition(n => n % 2 === 0));

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(partitioned)) {
        // consume
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toEqual(new Error('Test error'));
  });
});
