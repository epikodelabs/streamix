import {
  atom, derived, flow, getCurrentScope, setCurrentScope,
  isRuntimeInstrumentationEnabled, setRuntimeInstrumentationEnabled, __streamixRuntime,
} from '@epikodelabs/streamix';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('runtime graph ownership', () => {
  it('removes registered edges immediately on explicit disposal', async () => {
    const source = atom(1);
    const dependent = derived(() => source.value + 1);
    const { graph } = __streamixRuntime;
    try {
      expect(dependent.value).toBe(2);
      expect(graph.dependencies(dependent)).toEqual(new Set([source]));
      expect(graph.dependents(source)).toEqual(new Set([dependent]));
      await dependent.dispose();
      expect(graph.has(dependent)).toBeFalse();
      expect(graph.dependentCount(source)).toBe(0);
    } finally {
      await dependent.dispose();
      await source.dispose();
    }
  });

  for (const instrument of [false, true]) {
    it(`reclaims otherwise unreachable graphs with instrumentation ${instrument ? 'on' : 'off'}`, async () => {
      const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
      if (!gc) { pending('Run this spec in an isolated Node process with --expose-gc'); return; }
      if (instrument) await import('@epikodelabs/streamix/introspection');
      const previous = isRuntimeInstrumentationEnabled();
      const previousScope = getCurrentScope();
      setRuntimeInstrumentationEnabled(instrument);
      setCurrentScope(null);
      const reachable = atom(1);
      const live = derived(() => reachable.value + 1);
      const seen: number[] = [];
      const stop = live.subscribe(value => { seen.push(value); });
      try {
        const cohorts = Array.from({ length: 32 }, (_, i) => {
          const payload = { i };
          const lone = atom(payload);
          const source = atom(i);
          const child = derived(() => source.value + 1);
          expect(child.value).toBe(i + 1);
          const idleFlow = flow([i]);
          const control = { i };
          return [payload, lone, source, child, idleFlow, control].map(node => new WeakRef(node));
        });

        // Don't dereference weak references between collections. A dereference
        // keeps the target alive through the current job.
        for (let round = 0; round < 12; round++) {
          await tick();
          gc();
          await tick();
        }
        expect(cohorts.flat().filter(ref => ref.deref() !== undefined)).toEqual([]);
        expect(__streamixRuntime.graph.hasDependency(live, reachable)).toBeTrue();
        reachable.next(3);
        expect(seen).toEqual([2, 4]);
      } finally {
        await stop();
        await live.dispose();
        await reachable.dispose();
        setCurrentScope(previousScope);
        setRuntimeInstrumentationEnabled(previous);
      }
    });
  }
});
