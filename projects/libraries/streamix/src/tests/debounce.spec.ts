import { flow, debounce, from, interval, iterate, pipe, take } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('debounce', () => {
  it('should debounce values from an array stream', async () => {
    const values = [1, 2, 3, 4, 5];
    const debouncedAtom = pipe(from(values), debounce(10_000));
    const emittedValues: number[] = [];

    for await (const value of iterate(debouncedAtom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual([5]);
  });

  it('should debounce values from an interval stream', async () => {
    const sourceAtom = pipe(interval(50), take(5));
    const debouncedAtom = pipe(sourceAtom, debounce(120));
    const emittedValues: number[] = [];

    for await (const value of iterate(debouncedAtom)) {
      emittedValues.push(value);
    }

    expect(emittedValues.length).toBe(1);
    expect(emittedValues[0]).toBe(4);
  });

  it('should debounce values with rapid emissions', async () => {
    const values = [1, 2, 3, 4, 5];
    const intervalSource = flow<number>(async function* () {
      for (const value of values) {
        yield value;
        await wait(50);
      }
    });

    const debouncedAtom = pipe(intervalSource, debounce(100));
    const emittedValues: number[] = [];

    for await (const value of iterate(debouncedAtom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual([5]);
  });

  it('should support promise-based duration', async () => {
    const debouncedAtom = pipe(from([1, 2, 3]), debounce(Promise.resolve(10)));
    const emittedValues: number[] = [];

    for await (const value of iterate(debouncedAtom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual([3]);
  });

  it('should flush on completion when duration is undefined', async () => {
    const debouncedAtom = pipe(from([1, 2, 3]), debounce(undefined as any));
    const emittedValues: number[] = [];

    for await (const value of iterate(debouncedAtom)) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual([3]);
  });

  it('should propagate errors from the source', async () => {
    const sourceAtom = flow<number>(async function* () {
      yield 1;
      throw new Error('BOOM');
    });

    const debouncedAtom = pipe(sourceAtom, debounce(0));
    const values: number[] = [];
    let caught: any;

    try {
      for await (const value of iterate(debouncedAtom)) {
        values.push(value);
      }
    } catch (err) {
      caught = err;
    }

    expect(values).toEqual([]);
    expect(caught).toEqual(jasmine.any(Error));
    expect(caught.message).toBe('BOOM');
  });
});
