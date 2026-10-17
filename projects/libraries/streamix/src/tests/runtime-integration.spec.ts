import { atom, derived, NO_INITIAL_VALUE, transaction } from '../lib/atoms/atom';
import { internalRuntime } from '../lib/runtime/runtime';
import { createAsyncCoordinator } from '../lib/utils/coordinator';

describe('runtime end-to-end integration', () => {
  it('tracks only the active conditional branch, including unavailable values', () => {
    const flag = atom(false);
    const a = atom(7);
    const b = atom<number>();
    const result = derived(() => flag.value ? b.value : a.value);
    try {
      expect(result.value).toBe(7);
      expect(internalRuntime.graph.dependents(a).has(result)).toBeTrue();
      flag.set(true);
      expect(result.value).toBe(NO_INITIAL_VALUE as any);
      expect(internalRuntime.graph.dependents(a).has(result)).toBeFalse();
      expect(internalRuntime.graph.dependents(b).has(result)).toBeTrue();
      b.set(9);
      expect(result.value).toBe(9);
      flag.set(false);
      expect(result.value).toBe(7);
    } finally { result.dispose(); flag.dispose(); a.dispose(); b.dispose(); }
  });

  it('keeps undefined distinct from NO_INITIAL_VALUE', () => {
    const source = atom<number | undefined>(undefined);
    const result = derived(() => source.value);
    try { expect(result.value).toBeUndefined(); }
    finally { result.dispose(); source.dispose(); }
  });

  it('settles nested diamond transactions without intermediate delivery', () => {
    const a = atom(1), b = atom(2);
    const left = derived(() => a.value * 2);
    const right = derived(() => a.value + b.value);
    const result = derived(() => left.value + right.value);
    const seen: number[] = [];
    result.subscribe(value => seen.push(value));
    try {
      transaction(() => { a.set(3); transaction(() => b.set(4)); });
      expect(result.value).toBe(13);
      expect(seen).toEqual([5, 13]);
    } finally { result.dispose(); left.dispose(); right.dispose(); a.dispose(); b.dispose(); }
  });

  it('releases pending demand before asynchronous source cleanup completes', async () => {
    let finishCleanup!: (result: IteratorResult<number>) => void;
    const cleanup = new Promise<IteratorResult<number>>(resolve => finishCleanup = resolve);
    const coordinator = createAsyncCoordinator<number>([{
      next: () => new Promise<IteratorResult<number>>(() => {}),
      return: () => cleanup
    }]);
    const waiting = coordinator.next();
    const removing = coordinator.removeSource(0);
    expect((await waiting).done).toBeTrue();
    finishCleanup({ done: true, value: undefined });
    await removing;
    await coordinator.return!();
  });
});
