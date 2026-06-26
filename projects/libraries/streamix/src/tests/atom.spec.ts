import {
    atom,
    createTestEnvironment,
    derived,
    flow,
    getScheduler,
    scope,
    type Atom
} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('Atom System', () => {
  describe('atom()', () => {
    it('should create an atom with initial value', () => {
      const a = atom(42);
      expect(a.value).toBe(42);
      expect(a.safeValue).toBe(42);
      expect(a.disposed).toBe(false);
      expect(a.subscriberCount).toBe(0);
      a.dispose();
    });

    it('should create an atom without initial value', () => {
      const a = atom<number>();
      expect(a.value).toBeUndefined();
      expect(a.safeValue).toBeUndefined();
      a.dispose();
    });

    it('should update value with next()', () => {
      const a = atom(0);
      a.next(5);
      expect(a.value).toBe(5);
      expect(a.prior).toBe(0);
      a.dispose();
    });

    it('should notify on every next() call', async () => {
      const a = atom(0);
      let calls = 0;
      a.subscribe(() => calls++);
      a.next(0); // Same value still notifies
      expect(calls).toBe(1);
      a.next(1);
      expect(calls).toBe(2);
      a.next(1);
      expect(calls).toBe(3);
      a.dispose();
    });

    it('should notify subscribers on change', async () => {
      const a = atom(0);
      let value = 0;
      a.subscribe(v => { value = v; });
      a.next(5);
      expect(value).toBe(5);
      a.dispose();
    });

    it('should pass prior value to subscribers', async () => {
      const a = atom(0);
      const values: number[] = [];
      const priors: number[] = [];
      a.subscribe((v, prior) => { values.push(v); priors.push(prior!); });
      a.next(5);
      a.next(10);
      expect(values).toEqual([5, 10]);
      expect(priors).toEqual([0, 5]);
      a.dispose();
    });

    it('should handle multiple subscribers', async () => {
      const a = atom(0);
      let val1 = 0, val2 = 0;
      a.subscribe(v => { val1 = v; });
      a.subscribe(v => { val2 = v; });
      a.next(10);
      await delay(); // Allow microtask queue to drain
      expect(val1).toBe(10);
      expect(val2).toBe(10);
      a.dispose();
    });

    it('should return subscription with unsubscribe', async () => {
      const a = atom(0);
      let calls = 0;
      const sub = a.subscribe(() => calls++);
      a.next(1);
      await delay(); // Allow microtask queue to drain
      expect(calls).toBe(1);
      sub.unsubscribe();
      a.next(2);
      await delay(); // Allow microtask queue to drain
      expect(calls).toBe(1);
      a.dispose();
    });

    it('should handle errors with onError', async () => {
      const a = atom(0);
      let errorCaught: any = null;
      a.onError(err => { errorCaught = err; });
      a.fail(new Error('test error'));
      expect(errorCaught.message).toBe('test error');
      expect(a.error?.message).toBe('test error');
      a.dispose();
    });

    it('should recover from error state', async () => {
      const a = atom(0, { terminateOnError: false });
      a.fail(new Error('test'));
      expect(a.error.message).toBe('test');
      a.recover?.(); // This will trigger a flush
      expect(a.error).toBeUndefined();
      a.next(5);
      expect(a.value).toBe(5);
      a.dispose();
    });

    it('should terminate on error when configured', async () => {
      const a = atom(0, { terminateOnError: true });
      a.subscribe(() => {});
      a.fail(new Error('fatal'));
      expect(a.disposed).toBe(true);
      a.dispose();
    });

    it('should respect maxSubscribers limit', () => {
      const a = atom(0, { maxSubscribers: 2 });
      a.subscribe(() => {});
      a.subscribe(() => {});
      expect(() => a.subscribe(() => {})).toThrow(new Error('Maximum subscriber limit (2) reached')); // No await needed here as it's a sync throw
      a.dispose();
    });

    it('should support discrete option', () => {
      const a = atom(0, { discrete: true });
      expect(a.value).toBe(0);
      a.next(5);
      expect(a.value).toBe(5);
      a.dispose();
    });
  });

  describe('derived()', () => {
    it('should compute derived value', async () => {
      const source = atom(5);
      const doubled = derived(() => source.value * 2);
      expect(doubled.value).toBe(10);
      source.next(10);
      expect(doubled.value).toBe(20);
      source.dispose();
      doubled.dispose();
    });

    it('should compute derived value from atom source', async () => {
      const source = atom(5);
      const doubled = derived(source, s => s * 2);
      expect(doubled.value).toBe(10);
      source.next(10);
      expect(doubled.value).toBe(20);
      source.dispose();
      doubled.dispose();
    });

    it('should compute derived value from multiple atom sources', async () => {
      const a = atom(1);
      const b = atom(2);
      const sum = derived([a, b], (x, y) => x + y);
      expect(sum.value).toBe(3);
      a.next(5);
      expect(sum.value).toBe(7);
      b.next(10);
      expect(sum.value).toBe(15);
      a.dispose();
      b.dispose();
      sum.dispose();
    });

    it('should update when dependencies change', async () => {
      const a = atom(1);
      const b = atom(2);
      const sum = derived(() => a.value + b.value);
      expect(sum.value).toBe(3);
      a.next(5);
      expect(sum.value).toBe(7);
      b.next(10);
      expect(sum.value).toBe(15);
      a.dispose();
      b.dispose();
      sum.dispose();
    });

    it('should handle multiple dependencies', async () => {
      const a = atom(1);
      const b = atom(2);
      const c = atom(3);
      const result = derived(() => a.value * b.value + c.value);
      expect(result.value).toBe(5);
      a.next(2);
      expect(result.value).toBe(7);
      b.next(3);
      expect(result.value).toBe(9);
      c.next(4);
      expect(result.value).toBe(10);
      a.dispose();
      b.dispose();
      c.dispose();
      result.dispose();
    });

    it('should throw on circular dependency', () => {
      let derivedAtom: Atom<any>;
      const source = atom(0);
      // This creates a circular dependency
      expect(() => {
        derivedAtom = derived(() => {
          return derivedAtom ? derivedAtom.value : source.value;
        });
        derivedAtom.value;
      }).toThrow(new Error('Circular dependency detected in derived()'));
      source.dispose();
    });

    it('should handle errors in derived', async () => {
      const source = atom(0);
      const d = derived(() => {
        if (source.value > 10) throw new Error('Too high');
        return source.value;
      }, { terminateOnError: false });
      
      expect(d.value).toBe(0);
      source.next(15);
      expect(() => d.value).toThrow(new Error('Too high'));
      
      source.next(5);
      expect(d.value).toBe(5);
      
      source.dispose();
      d.dispose();
    });

    it('should terminate on error when configured', async () => {
      const source = atom(0);
      const d = derived(() => {
        throw new Error('fatal');
      }, { terminateOnError: true });
      
      expect(() => d.value).toThrow(new Error('fatal'));
      expect(d.disposed).toBe(true);
      
      source.dispose();
      d.dispose();
    });
  });

  describe('flow()', () => {
    it('should handle async iterable source', async () => {
      async function* generate() {
        yield 1;
        yield 2;
        yield 3;
      }
      
      const f = flow(generate());
      let values: number[] = [];
      f.subscribe(v => values.push(v));
      
      await delay(50);
      expect(values).toEqual([1, 2, 3]);
      f.dispose();
    });

    it('should handle sync iterable source', async () => { // Make it async to use await delay
      function* generate() {
        yield 1;
        yield 2;
        yield 3;
      }
      
      const f = flow(generate());
      let values: number[] = [];
      f.subscribe(v => values.push(v));
      
      await delay(50); // Allow microtask queue to drain for sync flow to complete
      expect(values).toEqual([1, 2, 3]);
      f.dispose();
    });

    it('should handle source factory function', async () => {
      const f = flow(async function*() {
        yield 1;
        yield 2;
        yield 3;
      });
      
      let values: number[] = [];
      f.subscribe(v => values.push(v));
      
      await delay(50);
      expect(values).toEqual([1, 2, 3]);
      f.dispose();
    });

    it('should support abort signal', async () => {
      const f = flow(async function*(signal?: AbortSignal) {
        let i = 0;
        while (!signal?.aborted) {
          yield i++;
          await delay(10);
        }
      });
      
      let values: number[] = [];
      const sub = f.subscribe(v => values.push(v));
      
      await delay(30);
      sub.unsubscribe();
      
      expect(values.length).toBeLessThan(5);
      f.dispose();
    });

    it('should handle errors', async () => {
      const f = flow(async function*() {
        yield 1;
        throw new Error('test error');
      });
      
      let error: any = null;
      f.onError(err => { error = err; });
      f.subscribe(() => {});

      await delay(50);
      expect(error?.message).toBe('test error');
      f.dispose();
    });

    it('should teardown previous iteration on dependency-triggered restart', async () => {
      const dep = atom(0);
      let cleanups = 0;
      let starts = 0;

      const f = flow((signal?: AbortSignal) => {
        starts++;
        dep.value; // track dependency
        return (async function* () {
          try {
            yield starts;
            while (!signal?.aborted) {
              await delay(10);
            }
          } finally {
            cleanups++;
          }
        })();
      });

      f.subscribe(() => {});
      await delay(30);
      expect(starts).toBe(1);
      expect(cleanups).toBe(0);

      dep.next(1); // trigger restart
      await delay(30);

      expect(starts).toBe(2);
      expect(cleanups).toBe(1); // old iteration cleaned up

      f.dispose();
      dep.dispose();
    });
  });


  describe('scheduler', () => {
    it('should use custom scheduler', async () => {
      const env = createTestEnvironment();

      env.run(() => {
        const s = scope(() => {
          const a = atom(0);
          a.subscribe(() => {});
          a.next(1);
          // In analog mode the public broadcast is deferred to the scheduler.
          expect(getScheduler().isDirty).toBe(true);
          return { a };
        }, { mode: 'analog' });

        env.flush();
        expect(getScheduler().isDirty).toBe(false);
        s.dispose();
      });

      env.reset();
    });
  });
});

