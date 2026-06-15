import {from, fromAny} from '@epikodelabs/streamix';

async function collect<T>(input: any): Promise<T[]> {
  const values: T[] = [];
  for await (const value of fromAny(input)) {
    values.push(value);
  }
  return values;
}

describe('fromAny', () => {
  it('should pass through a stream as-is', async () => {
    const sourceStream = from([1, 2, 3]);

    const result = fromAny(sourceStream);

    // Atoms are normalized into a stream-like iterable.
    const values = await collect<number>(result);
    expect(values).toEqual([1, 2, 3]);
  });

  it('should handle empty sources', async () => {
    const result = fromAny([]);

    const values = await collect<any>(result);
    expect(values).toEqual([]);
  });

  it('should emit a single value from a resolved promise', async () => {
    const values = await collect<number>(Promise.resolve(42));
    expect(values).toEqual([42]);
  });

  it('should handle promise of string', async () => {
    const values = await collect<string>(Promise.resolve('hello'));
    expect(values).toEqual(['hello']);
  });

  it('should handle promise of object', async () => {
    const obj = { id: 1, name: 'test' };
    const values = await collect<typeof obj>(Promise.resolve(obj));
    expect(values).toEqual([obj]);
  });

  it('should handle promise of null', async () => {
    const values = await collect<any>(Promise.resolve(null));
    expect(values).toEqual([null]);
  });

  it('should handle promise of undefined', async () => {
    const values = await collect<any>(Promise.resolve(undefined));
    expect(values).toEqual([undefined]);
  });

  it('should propagate promise rejection as stream error', async () => {
    const error = new Error('Test error');
    const promise = Promise.reject(error);
    // Prevent Node's unhandledRejection warning before consumption.
    void promise.catch(() => {});

    let caughtError: any = null;
    try {
      for await (const _ of fromAny(promise)) {
        void _;
      }
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBe(error);
  });

  it('should emit each element from an array', async () => {
    const values = await collect<number>([1, 2, 3, 4, 5]);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle promise of array', async () => {
    const values = await collect<number>(Promise.resolve([1, 2, 3]));
    expect(values).toEqual([1, 2, 3]);
  });

  it('should handle promise of empty array', async () => {
    const values = await collect<any>(Promise.resolve([]));
    expect(values).toEqual([]);
  });

  it('should handle array with mixed types', async () => {
    const values = await collect<any>([1, 'two', { three: 3 }, null, undefined]);
    expect(values).toEqual([1, 'two', { three: 3 }, null, undefined]);
  });

  it('should handle nested arrays (treats inner arrays as single values)', async () => {
    const values = await collect<number[]>([[1, 2], [3, 4], [5, 6]]);
    expect(values).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it('should emit a single number', async () => {
    const values = await collect<number>(42);
    expect(values).toEqual([42]);
  });

  it('should emit a single string', async () => {
    const values = await collect<string>('hello world');
    expect(values).toEqual(['hello world']);
  });

  it('should emit a single object', async () => {
    const obj = { id: 123, data: 'test' };
    const values = await collect<typeof obj>(obj);
    expect(values).toEqual([obj]);
  });

  it('should emit boolean values', async () => {
    expect(await collect<boolean>(true)).toEqual([true]);
    expect(await collect<boolean>(false)).toEqual([false]);
  });

  it('should emit null', async () => {
    const values = await collect<any>(null);
    expect(values).toEqual([null]);
  });

  it('should emit undefined', async () => {
    const values = await collect<any>(undefined);
    expect(values).toEqual([undefined]);
  });

  it('should emit zero', async () => {
    const values = await collect<number>(0);
    expect(values).toEqual([0]);
  });

  it('should emit empty string', async () => {
    const values = await collect<string>('');
    expect(values).toEqual(['']);
  });

  it('should handle delayed promise resolution', async () => {
    const promise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(99), 10);
    });

    const values = await collect<number>(promise);
    expect(values).toEqual([99]);
  });

  it('should handle array with promise elements', async () => {
    const values = await collect<number>([Promise.resolve(10), 20, 30]);
    expect(values).toEqual([10, 20, 30]);
  });

  it('should be usable multiple times', async () => {
    const source = fromAny([1, 2, 3]);

    const values1: number[] = [];
    for await (const value of source) {
      values1.push(value);
    }
    expect(values1).toEqual([1, 2, 3]);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const values2: number[] = [];
    for await (const value of source) {
      values2.push(value);
    }
    expect(values2).toEqual([1, 2, 3]);
  });

  it('should handle complex objects with methods', async () => {
    class TestClass {
      constructor(public value: number) {}
      getValue() { return this.value; }
    }

    const instance = new TestClass(42);
    const values = await collect<TestClass>(instance);

    expect(values.length).toBe(1);
    expect(values[0]).toBe(instance);
    expect(values[0].getValue()).toBe(42);
  });
});
