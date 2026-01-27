import { expand, from, map } from '@epikodelabs/streamix';

describe('expand', () => {
  it('should handle errors thrown by the project function', async () => {
    const error = new Error('Project function error');
    const project = (value: number) => {
      if (value === 3) throw error;
      return from([value + 1]);
    };

    const stream = from([1]);
    const result: number[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const value of stream.pipe(expand(project))) {
        result.push(value);
      }
    } catch (e) {
      caughtError = e as Error;
    }

    expect(result).toEqual([1, 2]);
    expect(caughtError).toEqual(error);
  });

  it('should recursively expand (depth-first by default)', async () => {
    const project = (value: number) => {
      if (value >= 3) return from([]);
      return from([value + 1]);
    };

    const result: number[] = [];
    for await (const value of from([1]).pipe(expand(project))) {
      result.push(value);
    }

    // Expected: 1, then 2 from 1, then 3 from 2
    expect(result).toEqual([1, 2, 3]);
  });

  it('should expand with breadth-first traversal', async () => {
    const project = (value: number) => {
      if (value >= 3) return from([]);
      return from([value + 1]);
    };

    const result: number[] = [];
    for await (const value of from([1]).pipe(expand(project, { traversal: 'breadth' }))) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should respect maxDepth and limit recursion', async () => {
    const project = (v: number) => from([v + 1]);

    const result: number[] = [];
    for await (const value of from([1]).pipe(expand(project, { maxDepth: 2 }))) {
      result.push(value);
    }

    // Depth 0: 1 ??? Depth 1: 2 ??? Depth 2: 3
    expect(result).toEqual([1, 2, 3]);
  });

  it('should emit nothing if input is empty', async () => {
    const project = (v: number) => from([v + 1]);

    const result: number[] = [];
    for await (const value of from([]).pipe(expand(project))) {
      result.push(value);
    }

    expect(result).toEqual([]);
  });

  it('should stop expanding when project returns an empty stream', async () => {
    const project = (value: number) => {
      if (value >= 5) return from([]);
      return from([value + 1]);
    };

    const result: number[] = [];
    for await (const value of from([1]).pipe(expand(project))) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle async project functions with promises', async () => {
    const project = async (value: number) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (value >= 3) return [];
      return [value + 1];
    };

    const result: number[] = [];
    for await (const value of from([1]).pipe(expand(project))) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should preserve metadata through expansions', async () => {
    const project = (value: number) => {
      if (value >= 3) return from([]);
      return from([value + 1]);
    };

    const result: number[] = [];
    const stream = from([1]).pipe(
      map(x => x), // Add metadata through map
      expand(project)
    );

    for await (const value of stream) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should handle depth-first traversal with metadata', async () => {
    const project = (value: number) => {
      if (value >= 3) return from([]);
      return from([value + 1]).pipe(map(x => x)); // Add metadata
    };

    const result: number[] = [];
    for await (const value of from([1]).pipe(expand(project, { traversal: 'depth' }))) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should handle multiple source values with depth-first', async () => {
    const project = (value: number) => {
      if (value >= 10) return from([]);
      return from([value * 2]);
    };

    const result: number[] = [];
    for await (const value of from([1, 5]).pipe(expand(project))) {
      result.push(value);
    }

    // Depth-first: 1 -> 2 -> 4 -> 8 -> 16 (16 emitted but not expanded), then 5 -> 10 (10 emitted but not expanded)
    expect(result).toEqual([1, 2, 4, 8, 16, 5, 10]);
  });

  it('should handle slow source with queue processing', async () => {
    let sourceIndex = 0;
    const slowSource = {
      async *[Symbol.asyncIterator]() {
        while (sourceIndex < 2) {
          await new Promise(resolve => setTimeout(resolve, 20));
          yield sourceIndex++;
        }
      }
    };

    const project = (value: number) => {
      if (value >= 2) return [];
      return [value + 10];
    };

    const result: number[] = [];
    for await (const value of from(slowSource).pipe(expand(project))) {
      result.push(value);
    }

    expect(result).toEqual([0, 10, 1, 11]);
  });
});


