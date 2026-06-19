import {
  atom,
  derived,
  flow,
  getCurrentScope,
  globalScope, scope
} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('Scope System', () => {
  afterEach(() => {
    if (globalScope) {
      globalScope.mode = 'discrete';
    }
  });

  describe('scope creation', () => {
    it('should create a scope', () => {
      const s = scope(() => ({}));
      expect(s.type).toBe('scope');
      expect(s.parent).toBe(globalScope);
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should merge factory return values', () => {
      const s = scope(() => {
        const count = atom(0);
        return { count };
      });
      const snapshot = s.snapshot();
      expect(snapshot.count).toBe(0);
      expect(s.count).toBeDefined();
      s.dispose();
    });

    it('should support dot notation on properties', async () => {
      const s = scope(() => {
        const count = atom(0);
        const doubled = derived(() => count.value * 2);
        return { count, doubled };
      });
      
      s.count.next(5);
      await delay();
      expect(s.doubled.value).toBe(10);
      expect(s.loading).toBe(false); // This should be false as all atoms had initial values
      s.dispose();
    });

    it('should support nested scopes', () => {
      const parent = scope(() => {
        const child = scope(() => {
          const x = atom(42);
          return { x };
        });
        return { child };
      });
      
      expect(parent.child.x.value).toBe(42);
      expect(parent.child.parent).toBe(parent);
      parent.dispose();
    });
  });

  describe('loading state', () => {
    it('should be true until all atoms emit', async () => {
      const s1 = atom<number>();
      const s2 = atom<string>();
      
      const s = scope(() => {
        const a = flow(s1, 0);
        const b = flow(s2, '');
        return { a, b };
      });
      
      expect(s.loading).toBe(true);
      
      s1.next(1);
      await delay();
      expect(s.loading).toBe(true);
      
      s2.next('x');
      await delay();
      expect(s.loading).toBe(false);
      
      s.dispose();
      s1.dispose();
      s2.dispose();
    });

    it('should be false for atoms with initial values', () => {
      const s = scope(() => {
        const a = atom(0);
        const b = atom('hello');
        return { a, b };
      });
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should track nested scope loading', async () => {
      const source = atom<number>();
      
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(source, 0);
          return { a };
        });
        return { child };
      });
      
      expect(parent.loading).toBe(true);
      
      source.next(42);
      await delay();
      expect(parent.loading).toBe(false);
      
      parent.dispose();
      source.dispose();
    });
  });

  describe('snapshot', () => {
    it('should capture all atom values', () => {
      const s = scope(() => {
        const count = atom(10);
        const name = atom('test');
        const doubled = derived(() => count.value * 2);
        return { count, name, doubled };
      });
      
      const snap = s.snapshot();
      expect(snap.count).toBe(10);
      expect(snap.name).toBe('test');
      expect(snap.doubled).toBe(20);
      s.dispose();
    });

    it('should capture nested scope values', () => {
      const s = scope(() => {
        const child = scope(() => {
          const x = atom(42);
          const y = atom('hello');
          return { x, y };
        });
        return { child };
      });
      
      const snap = s.snapshot();
      expect(snap.child.x).toBe(42);
      expect(snap.child.y).toBe('hello');
      s.dispose();
    });

    it('should handle errors in snapshot', async () => {
      const source = atom(0);
      const s = scope(() => {
        const d = derived(() => {
          if (source.value > 10) throw new Error('Too high');
          return source.value;
        }, { terminateOnError: false });
        return { d };
      });
      
      source.next(15);
      const snap = await s.snapshot();
      // Should still return something even with error
      expect(snap.d).toBeDefined();
      s.dispose();
      source.dispose();
    });
  });

  describe('disposal', () => {
    it('should dispose all atoms in scope', () => {
      const s = scope(() => {
        const a = atom(0);
        const b = atom(0);
        return { a, b };
      });
      
      expect(s.a.disposed).toBe(false);
      expect(s.b.disposed).toBe(false);
      
      s.dispose();
      expect(s.a.disposed).toBe(true);
      expect(s.b.disposed).toBe(true);
    });

    it('should dispose nested scopes recursively', () => {
      const source = atom(0);
      const parent = scope(() => {
        const child = scope(() => {
          const grandchild = scope(() => {
            const x = flow(source, 0);
            return { x };
          });
          return { grandchild };
        });
        return { child };
      });
      
      expect(parent.child.grandchild.x.disposed).toBe(false);
      parent.dispose();
      expect(parent.child.grandchild.x.disposed).toBe(true);
      source.dispose();
    });

    it('should run cleanup hooks', () => {
      let cleaned = false;
      const s = scope(() => {
        const _s = getCurrentScope();
        // Add cleanup hook
        (_s as any).cleanups.add(() => { cleaned = true; });
        return {};
      });
      
      s.dispose();
      expect(cleaned).toBe(true);
    });
  });

  describe('analog mode', () => {
    it('should batch atom emissions to the scheduler', async () => {
      const s = scope(() => {
        const a = atom(0);
        return { a };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      s.a.subscribe(v => values.push(v));
      
      s.a.next(1);
      s.a.next(2);
      s.a.next(3);
      
      expect(values).toEqual([]);
      await delay();
      expect(values).toEqual([3]);
      s.dispose();
    });

    it('should batch derived recomputations', async () => {
      const s = scope(() => {
        const a = atom(0);
        const doubled = derived(() => a.value * 2);
        return { a, doubled };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      s.doubled.subscribe(v => values.push(v));
      
      s.a.next(1);
      s.a.next(2);
      s.a.next(3);
      
      expect(values).toEqual([]);
      expect(s.doubled.value).toBe(6);
      
      await delay();
      expect(values).toEqual([6]);
      s.dispose();
    });

    it('should respect discrete opt-out', async () => {
      const s = scope(() => {
        const a = atom(0, { discrete: true });
        return { a };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      s.a.subscribe(v => values.push(v));
      
      s.a.next(1);
      s.a.next(2);
      await delay();
      expect(values).toEqual([1, 2]);
      s.dispose();
    });

    it('should inherit analog mode from parent', async () => {
      const parent = scope(() => {
        const child = scope(() => {
          const a = atom(0);
          return { a };
        });
        return { child };
      }, { mode: 'analog' });
      
      const childValues: number[] = [];
      parent.child.a.subscribe(v => childValues.push(v));
      
      parent.child.a.next(1);
      parent.child.a.next(2);
      parent.child.a.next(3);
      
      await delay();
      expect(parent.child.a.value).toBe(3);
      expect(childValues).toEqual([3]);
      
      parent.dispose();
    });

    it('should allow child to override parent analog mode', async () => {
      const parent = scope(() => {
        const child = scope(() => {
          const a = atom(0);
          return { a };
        }, { mode: 'discrete' });
        return { child };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      parent.child.a.subscribe(v => values.push(v));
      
      parent.child.a.next(1);
      parent.child.a.next(2);
      
      await delay();
      expect(values).toEqual([1, 2]);
      
      parent.dispose();
    });

    it('should keep derived values live in analog mode', async () => {
      const s = scope(() => {
        const a = atom(0);
        const doubled = derived(() => a.value * 2);
        return { a, doubled };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      s.doubled.subscribe(v => values.push(v));
      
      s.a.next(5);
      
      // Value is recomputed on read even before the scheduler flushes
      expect(s.doubled.value).toBe(10);
      expect(values).toEqual([]);
      
      await delay();
      expect(values).toEqual([10]);
      
      s.dispose();
    });

    it('should batch flow emissions in analog mode', async () => {
      const s = scope(() => {
        const source = atom<number>();
        const a = flow(source, 0);
        return { a, source };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      s.a.subscribe(v => values.push(v));
      
      s.source.next(1);
      s.source.next(2);
      s.source.next(3);
      
      // In analog mode, rapid source emissions are batched to a single scheduler
      // flush; the flow broadcasts only the latest value.
      expect(values).toEqual([]);
      await delay();
      expect(s.a.value).toBe(3);
      expect(values).toEqual([3]);
      
      s.dispose();
    });
  });

  describe('globalScope', () => {
    it('should default to discrete mode', () => {
      expect(globalScope.mode).toBe('discrete');
    });

    it('should make top-level scopes analog via global config', async () => {
      globalScope.mode = 'analog';
      
      const s = scope(() => {
        const a = atom(0);
        return { a };
      });
      
      const values: number[] = [];
      s.a.subscribe(v => values.push(v));
      
      s.a.next(1);
      s.a.next(2);
      s.a.next(3);
      
      expect(values).toEqual([]);
      await delay();
      expect(values).toEqual([3]);
      
      s.dispose();
    });

    it('should let child scopes override global analog mode', async () => {
      globalScope.mode = 'analog';
      
      const s = scope(() => {
        const a = atom(0);
        return { a };
      }, { mode: 'discrete' });
      
      const values: number[] = [];
      s.a.subscribe(v => values.push(v));
      
      s.a.next(1);
      s.a.next(2);
      
      await delay();
      expect(values).toEqual([1, 2]);
      s.dispose();
    });
  });

  describe('integration', () => {
    it('should maintain reactivity after scope disposal', async () => {
      const source = atom(0);
      const s = scope(() => {
        const a = flow(source, 0);
        return { a };
      });
      
      // Dispose scope
      s.dispose();
      
      // Source updates should not affect disposed atom
      source.next(42);
      await delay(20);
      expect(s.a.safeValue).toBe(0);
      expect(() => s.a.value).toThrow();
      
      source.dispose();
    });

    it('should handle complex reactive graph', async () => {
      const s = scope(() => {
        const a = atom(1);
        const b = atom(2);
        const sum = derived(() => a.value + b.value);
        const product = derived(() => a.value * b.value);
        const result = derived(() => sum.value + product.value);
        return { a, b, sum, product, result };
      });
      
      expect(s.sum.value).toBe(3);
      expect(s.product.value).toBe(2);
      expect(s.result.value).toBe(5);
      
      s.a.next(3);
      await delay();
      expect(s.sum.value).toBe(5);
      expect(s.product.value).toBe(6);
      expect(s.result.value).toBe(11);
      
      s.b.next(4);
      await delay();
      expect(s.sum.value).toBe(7);
      expect(s.product.value).toBe(12);
      expect(s.result.value).toBe(19);
      
      s.dispose();
    });
  });
});