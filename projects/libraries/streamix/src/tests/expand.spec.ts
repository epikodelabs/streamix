import { collect } from './helpers/operator';
import {expand, from, map, pipe, iterate} from '@epikodelabs/streamix';

describe('expand', () => {
  for (const traversal of ['depth', 'breadth'] as const) {
    it(`streams a non-terminating child incrementally (${traversal})`, async () => {
      let pulls = 0;
      let returned = 0;
      let release: ((result: IteratorResult<number>) => void) | undefined;
      const children = {
        [Symbol.asyncIterator]: () => ({
          next: (): Promise<IteratorResult<number>> => ++pulls === 1
            ? Promise.resolve({ value: 7, done: false })
            : new Promise(resolve => { release = resolve; }),
          return: async () => { returned++; release?.({ value: undefined, done: true }); return { value: undefined, done: true } as const; },
        }),
      };
      const output = expand<number>(() => children, { traversal, maxDepth: 1 })
        .apply(from([1])[Symbol.asyncIterator]());
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const first = await Promise.race([
          output.next(),
          new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 100); }),
        ]);
        expect(first).toEqual({ value: 1, done: false });
        if (first === null) return;
        expect(pulls).toBe(0);
        expect(await output.next()).toEqual({ value: 7, done: false });
        expect(pulls).toBe(1);
      } finally {
        clearTimeout(timeout);
        await output.return?.();
      }
      expect(returned).toBe(1);
    });
  }

  it('does not materialize an infinite synchronous child iterable', async () => {
    let pulls = 0;
    let closed = false;
    function* children() {
      try { while (true) yield ++pulls; }
      finally { closed = true; }
    }
    const output = expand<number>(() => children(), { maxDepth: 1 })
      .apply(from([0])[Symbol.asyncIterator]());
    const values: number[] = [];
    try {
      for (let i = 0; i < 5; i++) values.push((await output.next()).value);
      expect(values).toEqual([0, 1, 2, 3, 4]);
      expect(pulls).toBe(4);
    } finally { await output.return?.(); }
    expect(closed).toBeTrue();
  });

  it('preserves breadth-first order across a branching tree and separate roots', async () => {
    const children: Record<string, string[]> = {
      A: ['B', 'C'], B: ['D', 'E'], C: ['F'], X: ['Y'],
    };
    expect(await collect(iterate(pipe(from(['A', 'X']), expand<string>(
      node => children[node] ?? [], { traversal: 'breadth' },
    ))))).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y']);
  });

  for (const traversal of ['depth', 'breadth'] as const) {
    it(`closes a pending child pull and ignores its late result (${traversal})`, async () => {
      let release!: (value: IteratorResult<number>) => void;
      let returned = 0;
      const child = { [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<number>>(resolve => { release = resolve; }),
        return: async () => { returned++; return { done: true, value: undefined } as const; },
      }) };
      const output = expand<number>(() => child, { traversal, maxDepth: 1 })
        .apply(from([1])[Symbol.asyncIterator]());
      expect(await output.next()).toEqual({ done: false, value: 1 });
      const pending = output.next();
      await Promise.resolve();
      await output.return?.();
      expect(returned).toBe(1);
      release({ done: false, value: 99 });
      expect(await pending).toEqual({ done: true, value: undefined });
      await output.return?.();
      expect(returned).toBe(1);
    });
  }

  for (const method of ['return', 'throw'] as const) {
    it(`closes suspended ancestors and the source on ${method}`, async () => {
      const returned: number[] = [];
      const child = (value: number) => ({ [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value }),
        return: async () => { returned.push(value); return { done: true, value: undefined } as const; },
      }) });
      const source = {
        next: async () => ({ done: false, value: 1 }),
        return: async () => { returned.push(1); return { done: true, value: undefined } as const; },
      };
      const output = expand<number>(value => child(value + 1)).apply(source);
      expect((await output.next()).value).toBe(1);
      expect((await output.next()).value).toBe(2);
      if (method === 'throw') await expectAsync(output.throw!('stop')).toBeRejectedWithError('stop');
      else await output.return?.();
      expect(returned.sort()).toEqual([1, 2, 3]);
      await output.return?.();
      expect(returned.length).toBe(3);
    });
  }

  it('closes the source and suspended child when a nested projection fails', async () => {
    let sourceClosed = false;
    let childClosed = false;
    const child = { [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: false, value: 2 }),
      return: async () => { childClosed = true; return { done: true, value: undefined } as const; },
    }) };
    const output = expand<number>(value => {
      if (value === 2) throw new Error('nested failure');
      return child;
    }).apply({
      next: async () => ({ done: false, value: 1 }),
      return: async () => { sourceClosed = true; return { done: true, value: undefined } as const; },
    });
    expect((await output.next()).value).toBe(1);
    await expectAsync(output.next()).toBeRejectedWithError('nested failure');
    expect(childClosed).toBeTrue();
    expect(sourceClosed).toBeTrue();
  });

  it('expand depth traversal explores children before siblings', async () => {
    // Tree: A -> [B, C]; B -> [D]. Depth-first visits A, B, D, C.
    const children: Record<string, string[]> = { A: ['B', 'C'], B: ['D'], C: [], D: [] };

    const values = await collect(iterate(pipe(
      from(['A']),
      expand((node: string) => children[node] ?? []),
    )));

    expect(values).toEqual(['A', 'B', 'D', 'C']);
  });

  it('should handle errors thrown by the project function', async () => {
    const error = new Error('Project function error');
    const project = (value: number) => {
      if (value === 3) throw error;
      return [value + 1];
    };

    const atom = pipe(from([1]), expand(project));
    const result: number[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const value of iterate(atom)) {
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
      if (value >= 3) return [];
      return [value + 1];
    };

    const result: number[] = [];
    for await (const value of iterate(pipe(from([1]), expand(project)))) {
      result.push(value);
    }

    // Expected: 1, then 2 from 1, then 3 from 2
    expect(result).toEqual([1, 2, 3]);
  });

  it('should expand with breadth-first traversal', async () => {
    const project = (value: number) => {
      if (value >= 3) return [];
      return [value + 1];
    };

    const result: number[] = [];
    for await (const value of iterate(pipe(from([1]), expand(project, { traversal: 'breadth' })))) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should respect maxDepth and limit recursion', async () => {
    const project = (v: number) => [v + 1];

    const result: number[] = [];
    for await (const value of iterate(pipe(from([1]), expand(project, { maxDepth: 2 })))) {
      result.push(value);
    }

    // Depth 0: 1 -> Depth 1: 2 -> Depth 2: 3
    expect(result).toEqual([1, 2, 3]);
  });

  it('should emit nothing if input is empty', async () => {
    const project = (v: number) => [v + 1];

    const result: number[] = [];
    for await (const value of iterate(pipe(from([]), expand(project)))) {
      result.push(value);
    }

    expect(result).toEqual([]);
  });

  it('should stop expanding when project returns an empty stream', async () => {
    const project = (value: number) => {
      if (value >= 5) return [];
      return [value + 1];
    };

    const result: number[] = [];
    for await (const value of iterate(pipe(from([1]), expand(project)))) {
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
    for await (const value of iterate(pipe(from([1]), expand(project)))) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should preserve metadata through expansions', async () => {
    const project = (value: number) => {
      if (value >= 3) return [];
      return [value + 1];
    };

    const result: number[] = [];
    const atom = pipe(
      from([1]),
      map(x => x), // Add metadata through map
      expand(project)
    );

    for await (const value of iterate(atom)) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should handle depth-first traversal with metadata', async () => {
    const project = (value: number) => {
      if (value >= 3) return [];
      return [value + 1];
    };

    const result: number[] = [];
    for await (const value of iterate(pipe(from([1]), expand(project, { traversal: 'depth' })))) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3]);
  });

  it('should handle multiple source values with depth-first', async () => {
    const project = (value: number) => {
      if (value >= 10) return [];
      return [value * 2];
    };

    const result: number[] = [];
    for await (const value of iterate(pipe(from([1, 5]), expand(project)))) {
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
    for await (const value of iterate(pipe(from(slowSource), expand(project)))) {
      result.push(value);
    }

    expect(result).toEqual([0, 10, 1, 11]);
  });
});
