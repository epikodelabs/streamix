import { distinctUntilChanged, from, iterate, pipe } from '@epikodelabs/streamix';

describe('distinctUntilChanged', () => {
  it('should emit values that are distinct from the previous one', async () => {
    const atom = pipe(from([1, 1, 2, 2, 3, 3]), distinctUntilChanged());

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should not emit consecutive identical values', async () => {
    const atom = pipe(from([1, 1, 2, 2, 3, 3]), distinctUntilChanged());

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results.length).toBe(3);
  });

  it('should handle non-primitive values correctly', async () => {
    const atom = pipe(
      from([{ id: 1 }, { id: 1 }, { id: 2 }, { id: 2 }, { id: 3 }, { id: 3 }]),
      distinctUntilChanged<{ id: number }>((a, b) => a.id === b.id)
    );

    const results: { id: number }[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('should emit distinct objects based on reference equality', async () => {
    const object1 = { id: 1 };
    const object2 = { id: 2 };
    const object3 = { id: 3 };

    const atom = pipe(
      from([object1, object1, object2, object2, object3, object3]),
      distinctUntilChanged()
    );

    const results: { id: number }[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([object1, object2, object3]);
  });
});
