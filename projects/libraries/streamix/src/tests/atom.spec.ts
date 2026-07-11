import {
  atom,
  createTestEnvironment,
  derived,
  flow,
  getScheduler,
  scope,
  trackDependencies,
  type Atom,
  type DerivedScope,
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

    it('should treat a single object argument as an initial value', () => {
      const value = { discrete: false, terminateOnError: true };
      const a = atom(value);

      expect(a.value).toBe(value);
      expect(a.value.discrete).toBe(false);
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
      expect(a.previous).toBe(0);
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

    it('should pass previous value to subscribers', async () => {
      const a = atom(0);
      const currents: number[] = [];
      const previouses: number[] = [];
      a.subscribe((current, previous) => { currents.push(current); previouses.push(previous); });
      a.next(5);
      a.next(10);
      expect(currents).toEqual([5, 10]);
      expect(previouses).toEqual([0, 5]);
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
      const unsubscribe = a.subscribe(() => calls++);
      a.next(1);
      await delay(); // Allow microtask queue to drain
      expect(calls).toBe(1);
      unsubscribe();
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

    it('should keep the last safe value and clear errors via clearError()', () => {
      const a = atom(5, { terminateOnError: false });

      a.fail('boom');

      expect(() => a.value).toThrowError('boom');
      expect(a.safeValue).toBe(5);

      a.clearError?.();

      expect(a.error).toBeUndefined();
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

    it('should not schedule error broadcasts when propagateErrors is false', () => {
      const env = createTestEnvironment();

      env.run(() => {
        const a = atom(1, { propagateErrors: false });
        let broadcasts = 0;
        a.subscribe(() => broadcasts++);

        a.fail(new Error('hidden'));

        expect(broadcasts).toBe(0);
        expect(getScheduler().isDirty).toBe(false);
        a.dispose();
      });

      env.reset();
    });
  });

  describe('derived()', () => {
    it('should track dependencies read outside derived scopes', () => {
      const left = atom(2);
      const right = atom(3);

      const tracked = trackDependencies(() => left.value + right.value);

      expect(tracked.result).toBe(5);
      expect(Array.from(tracked.dependencies)).toEqual([left, right]);

      left.dispose();
      right.dispose();
    });

    it('should compute sync derived value from self.use atoms', () => {
      const source = atom(5);

      const doubled = derived((self: DerivedScope) => {
        const s = self.use(source);
        return s.value * 2;
      });

      expect(doubled.value).toBe(10);
      source.next(10);
      expect(doubled.value).toBe(20);

      source.dispose();
      doubled.dispose();
    });

    it('should compute sync derived from multiple self.use atoms', () => {
      const a = atom(1);
      const b = atom(2);

      const sum = derived((self: DerivedScope) => {
        const [x, y] = self.use(a, b);
        return x.value + y.value;
      });

      expect(sum.value).toBe(3);
      a.next(5);
      expect(sum.value).toBe(7);
      b.next(10);
      expect(sum.value).toBe(15);

      a.dispose();
      b.dispose();
      sum.dispose();
    });

    it('should throw on circular dependency', () => {
      let derivedAtom: Atom<any>;
      const source = atom(0);

      expect(() => {
        derivedAtom = derived((self: DerivedScope) => {
          const s = self.use(source);
          return derivedAtom ? derivedAtom.value : s.value;
        });
        derivedAtom.value;
      }).toThrow(new Error('Circular dependency detected in derived()'));

      source.dispose();
    });

    it('should support generator-based derived formulas', async () => {
      const source = atom(3);

      const generated = derived<number>(function* (): Generator<Atom<number> | Promise<number>, number, number> {
        const current = yield source;
        const incremented = yield Promise.resolve(current + 1);
        return incremented * 2;
      });

      expect(generated.value).toBeUndefined();
      await delay();
      expect(generated.value).toBe(8);

      source.next(4);
      await delay();
      expect(generated.value).toBe(10);

      source.dispose();
      generated.dispose();
    });

    it('should support class-based computables init and dispose hooks', () => {
      const source = atom(2);
      let initialized = 0;
      let disposed = 0;

      class CounterComputable {
        multiplier = 1;

        onInit() {
          initialized++;
          this.multiplier = 3;
        }

        compute(self: DerivedScope) {
          return self.read(source) * this.multiplier;
        }

        onDispose() {
          disposed++;
        }
      }

      const computed = derived<number>(CounterComputable as any);

      expect(initialized).toBe(1);
      expect(computed.value).toBe(6);

      source.next(4);
      expect(computed.value).toBe(12);

      computed.dispose();
      expect(disposed).toBe(1);

      source.dispose();
    });

    it('should handle errors in derived', () => {
      const source = atom(0);

      const d = derived((self: DerivedScope) => {
        const s = self.use(source);
        if (s.value > 10) throw new Error('Too high');
        return s.value;
      }, { terminateOnError: false });

      expect(d.value).toBe(0);
      source.next(15);
      expect(() => d.value).toThrow(new Error('Too high'));

      source.next(5);
      expect(d.value).toBe(5);

      source.dispose();
      d.dispose();
    });

    it('should terminate on error when configured', () => {
      const d = derived(() => {
        throw new Error('fatal');
      }, { terminateOnError: true });

      expect(() => d.value).toThrow(new Error('fatal'));
      expect(d.disposed).toBe(true);

      d.dispose();
    });


    it('should resolve async derived value from self.use atoms', async () => {
      const source = atom(5);

      const doubled = derived(async (self: DerivedScope) => {
        const s = self.use(source);
        await delay();
        return s.value * 2;
      });

      expect(doubled.value).toBeUndefined();

      await delay(15);
      expect(doubled.value).toBe(10);

      source.next(7);
      await delay(15);
      expect(doubled.value).toBe(14);

      source.dispose();
      doubled.dispose();
    });

    it('should track closure atoms across await with self.use()', async () => {
      const a = atom(1);
      const b = atom(2);

      const d = derived(async (self: DerivedScope) => {
        const [x, y] = self.use(a, b);
        await delay(5);
        return x.value + y.value;
      });

      expect(d.value).toBeUndefined();
      await delay(10);
      expect(d.value).toBe(3);

      a.next(5);
      expect(d.value).toBe(3); // old value until async recompute resolves
      await delay(15);
      expect(d.value).toBe(7);

      b.next(10);
      expect(d.value).toBe(7); // old value until async recompute resolves
      await delay(15);
      expect(d.value).toBe(15);

      a.dispose();
      b.dispose();
      d.dispose();
    });

    it('should keep the stale async derived value readable while background revalidation runs', async () => {
      const source = atom(1);

      const total = derived(async (self: DerivedScope) => {
        const current = self.use(source);
        await delay(5);
        return current.value * 10;
      });

      expect(total.value).toBeUndefined();
      await delay(10);
      expect(total.value).toBe(10);

      source.next(2);
      expect(total.value).toBe(10);

      await delay(15);
      expect(total.value).toBe(20);

      source.dispose();
      total.dispose();
    });

    it('should ignore stale promise when dependency changes', async () => {
      const source = atom(1);

      const asyncDerived = derived(async (self: DerivedScope) => {
        const s = self.use(source);
        const value = s.value;
        return new Promise<number>(resolve => {
          setTimeout(() => resolve(value * 10), 20);
        });
      });

      expect(asyncDerived.value).toBeUndefined();

      source.next(2);
      await delay(30);
      expect(asyncDerived.value).toBe(20);

      source.dispose();
      asyncDerived.dispose();
    });

    it('should preserve the last safe value after async derived rejection', async () => {
      const source = atom(1);

      const unstable = derived(async (self: DerivedScope) => {
        const current = self.use(source).value;
        await delay(5);

        if (current > 1) {
          throw 'async boom';
        }

        return current * 10;
      });

      expect(unstable.value).toBeUndefined();
      await delay(15);
      expect(unstable.value).toBe(10);

      source.next(2);
      await delay(15);

      expect(() => unstable.value).toThrowError('async boom');
      expect(unstable.safeValue).toBe(10);

      source.dispose();
      unstable.dispose();
    });

    it('should not prune a dependency once read, even after a later run takes a different branch', () => {
      const useA = atom(true);
      const a = atom(1);
      const b = atom(2);

      let evaluations = 0;
      const d = derived((self: DerivedScope) => {
        evaluations++;
        const flag = self.use(useA);
        return flag.value ? self.use(a).value : self.use(b).value;
      });

      // First run reads `a` (branch taken: useA === true).
      expect(d.value).toBe(1);
      expect(evaluations).toBe(1);

      // Switch branches: this run reads `b` instead of `a`.
      useA.next(false);
      expect(d.value).toBe(2);
      expect(evaluations).toBe(2);

      // `a` was only read on the *first* run, and is no longer read on the
      // latest run. A pruning implementation would have unsubscribed from
      // it after the second run; this implementation keeps it subscribed
      // for the node's lifetime, so changing it still triggers a recompute
      // even though the recomputed value is unchanged (still reads `b`).
      a.next(99);
      expect(evaluations).toBe(3);
      expect(d.value).toBe(2); // value unchanged: current run still reads `b`

      // `b` remains the live dependency and still drives the value.
      b.next(20);
      expect(evaluations).toBe(4);
      expect(d.value).toBe(20);

      useA.dispose();
      a.dispose();
      b.dispose();
      d.dispose();
    });

    it('should reject invalid derived inputs', () => {
      expect(() => (derived as any)(123)).toThrowError('derived() requires a function as the first argument');
    });
  });

  describe('flow()', () => {
    it('should seed flow atoms from another atom safeValue', async () => {
      const source = atom(7);
      const streamed = flow(source);
      const values: number[] = [];

      expect(streamed.value).toBe(7);

      const unsubscribe = streamed.subscribe(value => values.push(value));
      source.next(9);
      await delay(10);

      expect(values).toContain(9);

      unsubscribe();
      streamed.dispose();
      source.dispose();
    });

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
      const unsubscribe = f.subscribe(v => values.push(v));
      
      await delay(30);
      unsubscribe();
      
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

    it('should not double-report flow errors and should honor terminateOnError false', async () => {
      let optionErrors = 0;
      let subscriptionErrors = 0;

      const f = flow(async function*() {
        yield 1;
        throw new Error('boom');
      }, {
        terminateOnError: false,
        onError: () => { optionErrors++; },
      });

      f.onError(() => { subscriptionErrors++; });
      f.subscribe(() => {});

      await delay(50);

      expect(optionErrors).toBe(1);
      expect(subscriptionErrors).toBe(1);
      expect(f.disposed).toBe(false);
      expect(f.safeValue).toBe(1);
      expect(() => f.value).toThrowError('boom');
      f.dispose();
    });

    it('should handle concurrent dispose() calls without duplicate cleanup', async () => {
      let cleanups = 0;
      const f = flow(async function*() {
        try {
          while (true) {
            yield 1;
            await delay(10);
          }
        } finally {
          cleanups++;
          await delay(30);
        }
      });

      f.subscribe(() => {});
      await delay(20);

      f.dispose();
      f.dispose();
      f.dispose();

      await delay(100);
      expect(f.disposed).toBe(true);
      expect(cleanups).toBe(1);
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
