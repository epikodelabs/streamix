import { createStream, fromAny } from '@actioncrew/streamix';

describe('fromAny', () => {
  it('should pass through a stream as-is', async () => {
    const sourceStream = createStream('test', async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    const result = fromAny(sourceStream);
    
    // Should be the exact same stream instance
    expect(result).toBe(sourceStream);
    
    // Verify it still works
    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([1, 2, 3]);
  });

  it('should handle empty streams', async () => {
    const emptyStream = createStream('empty', async function* () {
      // yields nothing
    });

    const result = fromAny(emptyStream);
    
    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([]);
  });

  it('should emit a single value from a resolved promise', async () => {
    const promise = Promise.resolve(42);
    const result = fromAny(promise);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([42]);
  });

  it('should handle promise of string', async () => {
    const promise = Promise.resolve('hello');
    const result = fromAny(promise);

    const values: string[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual(['hello']);
  });

  it('should handle promise of object', async () => {
    const obj = { id: 1, name: 'test' };
    const promise = Promise.resolve(obj);
    const result = fromAny(promise);

    const values: typeof obj[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([obj]);
  });

  it('should handle promise of null', async () => {
    const promise = Promise.resolve(null);
    const result = fromAny(promise);

    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([null]);
  });

  it('should handle promise of undefined', async () => {
    const promise = Promise.resolve(undefined);
    const result = fromAny(promise);

    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([undefined]);
  });

  it('should propagate promise rejection as stream error', async () => {
    const error = new Error('Test error');
    const promise = Promise.reject(error);
    const result = fromAny(promise);

    let caughtError: any = null;
    try {
      for await (const _ of result) {
        // Should not reach here
      }
    } catch (err) {
      caughtError = err;
    }
    
    expect(caughtError).toBe(error);
  });

  it('should emit each element from a promise of array', async () => {
    const promise = Promise.resolve([1, 2, 3, 4, 5]);
    const result = fromAny(promise);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle promise of empty array', async () => {
    const promise = Promise.resolve([]);
    const result = fromAny(promise);

    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([]);
  });

  it('should handle promise of array with mixed types', async () => {
    const promise = Promise.resolve([1, 'two', { three: 3 }, null, undefined]);
    const result = fromAny(promise);

    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([1, 'two', { three: 3 }, null, undefined]);
  });

  it('should handle promise of array of objects', async () => {
    const objects = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' }
    ];
    const promise = Promise.resolve(objects);
    const result = fromAny(promise);

    const values: typeof objects = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual(objects);
  });

  it('should emit each element from an array', async () => {
    const result = fromAny([1, 2, 3, 4, 5]);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle empty array', async () => {
    const result = fromAny([]);

    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([]);
  });

  it('should handle array with single element', async () => {
    const result = fromAny([42]);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([42]);
  });

  it('should handle array of strings', async () => {
    const result = fromAny(['a', 'b', 'c']);

    const values: string[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual(['a', 'b', 'c']);
  });

  it('should handle array of objects', async () => {
    const objects = [
      { x: 1 },
      { x: 2 },
      { x: 3 }
    ];
    const result = fromAny(objects);

    const values: typeof objects = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual(objects);
  });

  it('should handle nested arrays (treats inner arrays as single values)', async () => {
    const nested = [[1, 2], [3, 4], [5, 6]];
    const result = fromAny(nested);

    const values: number[][] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it('should emit a single number', async () => {
    const result = fromAny(42);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([42]);
  });

  it('should emit a single string', async () => {
    const result = fromAny('hello world');

    const values: string[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual(['hello world']);
  });

  it('should emit a single object', async () => {
    const obj = { id: 123, data: 'test' };
    const result = fromAny(obj);

    const values: typeof obj[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([obj]);
  });

  it('should emit boolean true', async () => {
    const result = fromAny(true);

    const values: boolean[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([true]);
  });

  it('should emit boolean false', async () => {
    const result = fromAny(false);

    const values: boolean[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([false]);
  });

  it('should emit null', async () => {
    const result = fromAny(null);

    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([null]);
  });

  it('should emit undefined', async () => {
    const result = fromAny(undefined);

    const values: any[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([undefined]);
  });

  it('should emit zero', async () => {
    const result = fromAny(0);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([0]);
  });

  it('should emit empty string', async () => {
    const result = fromAny('');

    const values: string[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual(['']);
  });

  it('should handle delayed promise resolution', async () => {
    const promise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(99), 10);
    });
    const result = fromAny(promise);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([99]);
  });

  it('should handle delayed promise with array', async () => {
    const promise = new Promise<number[]>((resolve) => {
      setTimeout(() => resolve([10, 20, 30]), 10);
    });
    const result = fromAny(promise);

    const values: number[] = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([10, 20, 30]);
  });

  it('should be usable multiple times', async () => {
    const result = fromAny([1, 2, 3]);

    // First iteration
    const values1: number[] = [];
    for await (const value of result) {
      values1.push(value);
    }
    expect(values1).toEqual([1, 2, 3]);

    // Second iteration
    const values2: number[] = [];
    for await (const value of result) {
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
    const result = fromAny(instance);

    const values: TestClass[] = [];
    for await (const value of result) {
      values.push(value);
    }
    
    expect(values.length).toBe(1);
    expect(values[0]).toBe(instance);
    expect(values[0].getValue()).toBe(42);
  });
});