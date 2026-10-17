import { atom } from '../lib/atoms/atom';
import { scope } from '../lib/atoms/scope';
import { from } from '../lib/factories/from';
import { pipe } from '../lib/atoms/pipe';
import { iterate } from '../lib/atoms/iterate';
import { switchMap } from '../lib/operators/switchMap';
import { exhaustMap } from '../lib/operators/exhaustMap';

async function collect<T>(source: any): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterate(source)) values.push(value as T);
  return values;
}

describe('runtime scope and flow integration', () => {
  it('disposes atoms materialized inside a scope', () => {
    const model = scope({ count: 2 });
    const count = (model as any)._rawState.count;
    expect(count.disposed).toBe(false);
    model.dispose();
    expect(count.disposed).toBe(true);
  });

  it('does not dispose a borrowed atom', () => {
    const shared = atom(7);
    const model = scope({ shared });
    model.dispose();
    expect(shared.disposed).toBe(false);
    shared.dispose();
  });

  it('keeps a separately constructed nested scope alive', () => {
    const child = scope({ value: 4 });
    const parent = scope({ child });
    parent.dispose();
    expect((child as any)._disposed).toBe(false);
    child.dispose();
  });

  it('disposes scopes idempotently', () => {
    const model = scope({ count: 1 });
    model.dispose();
    model.dispose();
    expect((model as any)._disposed).toBe(true);
  });

  it('switchMap keeps the latest synchronous inner', async () => {
    const result = await collect<number>(pipe(from([1, 2, 3]), switchMap((x: number) => [x * 10])));
    expect(result).toEqual([30]);
  });

  it('switchMap ignores late obsolete asynchronous projections', async () => {
    const result = await collect<number>(pipe(from([1, 2]), switchMap((x: number) =>
      new Promise<number>(resolve => setTimeout(() => resolve(x * 10), x === 1 ? 40 : 2))
    )));
    expect(result).toEqual([20]);
  });

  it('exhaustMap processes a finite inner', async () => {
    const result = await collect<number>(pipe(from([1, 2]), exhaustMap((x: number) => [x, x + 10])));
    expect(result.length).toBeGreaterThan(0);
  });
});
