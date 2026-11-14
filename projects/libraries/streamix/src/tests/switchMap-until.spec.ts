import {
  bufferUntil, delayUntil, DONE, from, skipUntil, switchMap, takeUntil, type Readable,
} from '@epikodelabs/streamix';

type GatedValue = number | number[];
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const within = async <T>(promise: Promise<T>): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('pipeline stalled')), 200); }),
    ]);
  } finally { clearTimeout(timeout); }
};

const collect = async <T>(iterator: AsyncIterator<T>) => {
  const values: T[] = [];
  for (let item = await iterator.next(); !item.done; item = await iterator.next()) values.push(item.value);
  return values;
};

const cases: Array<{
  name: string;
  wrap: (source: AsyncIterator<number>, notifier?: Readable<number>) => AsyncIterator<GatedValue>;
}> = [
  { name: 'takeUntil', wrap: (source, notifier = from<number>([])) => takeUntil<number>(notifier).apply(source) },
  { name: 'skipUntil', wrap: (source, notifier = from([1])) => skipUntil<number>(notifier).apply(source) },
  { name: 'delayUntil', wrap: (source, notifier = from([1])) => delayUntil<number>(notifier).apply(source) },
  { name: 'bufferUntil', wrap: (source, notifier = from<number>([])) => bufferUntil<number>(notifier).apply(source) },
];

describe('switchMap after Until operators', () => {
  it('uses asynchronous pulls without adding a fake push capability', async () => {
    let pulls = 0;
    const source = {
      __tryNext: () => null,
      next: async () => ++pulls === 1 ? { done: false, value: 1 } : DONE,
    };
    const output = switchMap<number, number>(value => [value]).apply(source);
    try {
      expect(await within(collect(output))).toEqual([1]);
      expect(pulls).toBe(2);
      expect('__onPush' in source).toBeFalse();
    } finally { await output.return?.(); }
  });

  for (const { name, wrap } of cases) {
    const project = (value: GatedValue) => [10 * (Array.isArray(value) ? value[0] : value)];

    it(`emits asynchronous values and completes after ${name}`, async () => {
      async function* source() { await wait(1); yield 1; }
      const output = switchMap(project).apply(wrap(source()));
      try { expect(await within(collect(output))).toEqual([10]); }
      finally { await output.return?.(); }
    });

    it(`propagates asynchronous source errors after ${name}`, async () => {
      async function* source(): AsyncGenerator<number> { await wait(1); throw new Error('source failed'); }
      const output = switchMap(project).apply(wrap(source()));
      try { await expectAsync(within(output.next())).toBeRejectedWithError('source failed'); }
      finally { await output.return?.(); }
    });

    it(`propagates asynchronous notifier errors after ${name}`, async () => {
      let release!: (value: IteratorResult<number>) => void;
      const source = {
        next: () => new Promise<IteratorResult<number>>(resolve => { release = resolve; }),
        return: async () => { release?.(DONE); return DONE; },
      };
      async function* notifier(): AsyncGenerator<number> { await wait(1); throw new Error('notifier failed'); }
      const output = switchMap(project).apply(wrap(source, from(notifier())));
      try { await expectAsync(within(output.next())).toBeRejectedWithError('notifier failed'); }
      finally { await output.return?.(); }
    });

    it(`closes ${name} with a pending outer pull and ignores its late value`, async () => {
      let release!: (value: IteratorResult<number>) => void;
      let returned = 0;
      const source = {
        next: () => new Promise<IteratorResult<number>>(resolve => { release = resolve; }),
        return: async () => { returned++; return DONE; },
      };
      let projected = 0;
      const output = switchMap<GatedValue, number>(() => { projected++; return [1]; }).apply(wrap(source));
      const pending = output.next();
      await within(output.return!());
      expect(await within(pending)).toEqual(DONE);
      release({ done: false, value: 99 });
      await wait(1);
      expect(projected).toBe(0);
      expect(returned).toBe(1);
    });
  }
});
