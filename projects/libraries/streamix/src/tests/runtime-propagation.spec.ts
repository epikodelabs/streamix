import { atom, derived, transaction } from '@epikodelabs/streamix';
import { atomFromIterator } from '../lib/atoms/atom';

describe('runtime graph propagation', () => {
  it('settles each ordinary write synchronously without intermediate diamond values', async () => {
    const source = atom(1);
    const left = derived(() => source.value * 2);
    const right = derived(() => source.value + 10);
    const combined = derived(() => left.value + right.value);
    const values: number[] = [];
    combined.subscribe(value => values.push(value));
    try {
      source.next(2);
      // Check delivery before reading .value, which could recompute on demand.
      expect(values).toEqual([13, 16]);
      source.set(3);
      expect(values).toEqual([13, 16, 19]);
      await Promise.resolve();
      expect(values).toEqual([13, 16, 19]);
    } finally {
      combined.dispose(); right.dispose(); left.dispose(); source.dispose();
    }
  });

  it('defers nested transaction notifications until the outer commit', () => {
    const source = atom(1);
    const doubled = derived(() => source.value * 2);
    const values: number[] = [];
    doubled.subscribe(value => values.push(value));
    try {
      transaction(() => {
        source.set(2);
        transaction(() => source.set(3));
        expect(values).toEqual([2]);
        source.set(4);
      });
      expect(values).toEqual([2, 8]);
    } finally {
      doubled.dispose(); source.dispose();
    }
  });

  it('drains writes made by derived subscribers before the outer write returns', async () => {
    const source = atom(0);
    const doubled = derived(() => source.value * 2);
    const values: number[] = [];
    doubled.subscribe(value => {
      values.push(value);
      if (value === 2) source.set(2);
    });
    try {
      source.set(1);
      expect(values).toEqual([0, 2, 4]);
      await Promise.resolve();
      expect(values).toEqual([0, 2, 4]);
    } finally {
      doubled.dispose(); source.dispose();
    }
  });

  it('settles each iterator emission before requesting the next value', async () => {
    const values: number[] = [];
    const snapshots: number[][] = [];
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    let pulls = 0;
    const source = atomFromIterator<number>({
      [Symbol.asyncIterator]() {
        return {
          next() {
            snapshots.push([...values]);
            if (++pulls <= 2) return Promise.resolve({ done: false as const, value: pulls });
            finish();
            return Promise.resolve({ done: true as const, value: undefined });
          }
        };
      }
    });
    const left = derived(() => source.value * 2);
    const right = derived(() => source.value + 10);
    const combined = derived(() => left.value + right.value);
    combined.subscribe(value => values.push(value));
    const stop = source.subscribe(() => {});
    try {
      await finished;
      expect(snapshots).toEqual([[], [13], [13, 16]]);
      expect(values).toEqual([13, 16]);
    } finally {
      stop(); combined.dispose(); right.dispose(); left.dispose(); source.dispose();
    }
  });

  it('delivers a diamond result once after both upstream branches settle', () => {
    const source = atom(1);
    const left = derived(() => source.value * 2);
    const right = derived(() => source.value + 10);
    const combined = derived(() => left.value + right.value);
    const values: number[] = [];
    combined.subscribe(value => values.push(value));
    expect(values).toEqual([13]);

    transaction(() => source.set(2));
    expect(combined.value).toBe(16);
    expect(values).toEqual([13, 16]);
    combined.dispose(); right.dispose(); left.dispose(); source.dispose();
  });

  it('does not publish partial results from multi-source transactions', () => {
    const first = atom(1);
    const second = atom(2);
    const left = derived(() => first.value + second.value);
    const right = derived(() => first.value * second.value);
    const combined = derived(() => left.value + right.value);
    const values: number[] = [];
    combined.subscribe(value => values.push(value));

    transaction(() => {
      first.set(3);
      second.set(4);
      expect(values).toEqual([5]);
    });
    expect(values).toEqual([5, 19]);
    combined.dispose(); right.dispose(); left.dispose(); second.dispose(); first.dispose();
  });

  it('drops obsolete conditional edges before the next source change', () => {
    const choice = atom(true);
    const a = atom(1);
    const b = atom(10);
    const selected = derived(() => choice.value ? a.value : b.value);
    const values: number[] = [];
    selected.subscribe(value => values.push(value));

    transaction(() => choice.set(false));
    transaction(() => a.set(2));
    transaction(() => b.set(11));
    expect(values).toEqual([1, 10, 11]);
    selected.dispose(); b.dispose(); a.dispose(); choice.dispose();
  });
});
