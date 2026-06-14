import { atom, derived, flow, globalScope, scope } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('scope', () => {
  afterEach(() => {
    globalScope!.mode = 'discrete';
    globalScope!.strobe = 0;
  });

  it('should create a scope', () => {
    const s = scope(() => ({}));
    expect(s.parent).toBe(globalScope);
    s.dispose();
  });

  it('should merge factory return value', () => {
    const s = scope(() => {
      const count = flow(atom<number>(), 0);
      return { count };
    });
    expect(s.count.value).toBe(0);
    s.dispose();
  });

  it('should auto-register atoms created inside factory', () => {
    const source = atom<number>();
    const s = scope(() => {
      const a = flow(source, 0);
      return { a };
    });
    expect(s.a.disposed).toBeFalse();
    s.dispose();
    expect(s.a.disposed).toBeTrue();
    source.dispose();
  });

  it('should support snapshot', () => {
    const s1 = atom<number>();
    const s2 = atom<number>();
    const s = scope(() => {
      const a = flow(s1, 1);
      const b = flow(s2, 2);
      return { a, b };
    });
    expect(s.snapshot()).toEqual({ a: 1, b: 2 });
    s.dispose();
    s1.dispose();
    s2.dispose();
  });

  it('should create nested scopes', () => {
    const parent = scope(() => {
      const child = scope(() => ({}));
      return { child };
    });
    expect(parent.child.parent).toBe(parent);
    parent.dispose();
  });

  it('should dispose descendants recursively', () => {
    const source = atom<number>();
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

    expect(parent.child.grandchild.x.disposed).toBeFalse();
    parent.dispose();
    expect(parent.child.grandchild.x.disposed).toBeTrue();
    source.dispose();
  });

  it('should snapshot nested scopes', () => {
    const s = scope(() => {
      const child = scope(() => {
        const a = flow(atom<number>(), 42);
        return { a };
      });
      return { child };
    });
    expect(s.snapshot()).toEqual({ child: { a: 42 } });
    s.dispose();
  });

  it('should react to source emissions inside scope', async () => {
    const s1 = atom<number>();
    const s2 = atom<number>();
    const s = scope(() => {
      const a = flow(s1, 1);
      const b = flow(s2, 2);
      return { a, b };
    });

    s1.next(10);
    await delay();
    expect(s.a.value).toBe(10);

    s2.next(20);
    await delay();
    expect(s.b.value).toBe(20);

    s.dispose();
    s1.dispose();
    s2.dispose();
  });

  describe('loading', () => {
    it('should be false for an empty scope', () => {
      const s = scope(() => {});
      expect(s.loading).toBeFalse();
      s.dispose();
    });

    it('should be true until all atoms have emitted', async () => {
      const s1 = atom<number>();
      const s2 = atom<string>();
      const s = scope(() => {
        const a = flow(s1, 0);
        const b = flow(s2, '');
        return { a, b };
      });

      expect(s.loading).toBeTrue();

      s1.next(1);
      await delay();
      expect(s.loading).toBeTrue();

      s2.next('x');
      await delay();
      expect(s.loading).toBeFalse();

      s.dispose();
      s1.dispose();
      s2.dispose();
    });

    it('should track recursive loading through nested scopes', async () => {
      const source = atom<number>();
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(source, 0);
          return { a };
        });
        return { child };
      });

      expect(parent.loading).toBeTrue();

      source.next(1);
      await delay();
      expect(parent.loading).toBeFalse();

      parent.dispose();
      source.dispose();
    });

    it('should become false when atom emits', async () => {
      const source = atom<number>();
      const s = scope(() => {
        const a = flow(source, 0);
        return { a };
      });

      expect(s.loading).toBeTrue();
      source.next(1);
      await delay();
      expect(s.loading).toBeFalse();

      s.dispose();
      source.dispose();
    });

    it('should be false for scopes with initial-value atoms', () => {
      const s = scope(() => {
        const a = atom(0);
        return { a };
      });
      expect(s.loading).toBeFalse();
      s.dispose();
    });
  });

  describe('strobe', () => {
    it('should sample atom emissions with scope strobe', async () => {
      const s = scope(() => {
        const a = atom(0);
        return { a };
      }, { strobe: 50 });

      const values: number[] = [];
      s.a.subscribe(v => values.push(v));

      s.a.next(1);
      s.a.next(2);
      s.a.next(3);

      expect(s.a.value).toBe(3);
      expect(values).toEqual([]);

      await delay(70);
      expect(values).toEqual([3]);

      s.dispose();
    });

    it('should sample flow emissions with scope strobe', async () => {
      const source = atom<number>();
      const s = scope(() => {
        const a = flow(source, 0);
        return { a };
      }, { strobe: 50 });

      const values: number[] = [];
      s.a.subscribe(v => values.push(v));

      source.next(1);
      source.next(2);
      source.next(3);

      await delay(70);
      expect(s.a.value).toBe(3);
      expect(values).toContain(3);

      s.dispose();
      source.dispose();
    });

    it('should inherit strobe from parent scope', async () => {
      const source = atom<number>();
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(source, 0);
          return { a };
        });
        return { child };
      }, { strobe: 50 });

      source.next(1);
      source.next(2);

      await delay(70);
      expect(parent.child.a.value).toBe(2);

      parent.dispose();
      source.dispose();
    });

    it('should allow child scope to override parent strobe', async () => {
      let parent: any;
      try {
        parent = scope(() => {
          const child = scope(() => {
            const a = atom(0);
            return { a };
          }, { strobe: 150 });
          return { child };
        }, { strobe: 50 });

        const values: number[] = [];
        parent.child.a.subscribe(v => values.push(v));

        parent.child.a.next(1);
        parent.child.a.next(2);

        expect(values).toEqual([]);
        await delay(70);
        expect(values).toEqual([]);

        await delay(100);
        expect(values).toEqual([2]);
      } finally {
        parent?.dispose();
      }
    });

    it('should stop sampling when scope is disposed', async () => {
      const source = atom<number>();
      const s = scope(() => {
        const a = flow(source, 0);
        return { a };
      }, { strobe: 50 });

      s.dispose();

      source.next(1);
      source.next(2);

      await delay(70);
      expect(s.a.safeValue).toBe(0);
      expect(() => s.a.value).toThrowError();

      source.dispose();
    });

    it('should batch derived recomputations on strobe', async () => {
      const s = scope(() => {
        const a = atom(0);
        const doubled = derived(() => a.value * 2);
        return { a, doubled };
      }, { strobe: 50 });

      const values: number[] = [];
      s.doubled.subscribe(v => values.push(v));

      s.a.next(1);
      s.a.next(2);
      s.a.next(3);

      expect(s.doubled.value).toBe(0);
      expect(values).toEqual([]);

      await delay(70);
      expect(s.doubled.value).toBe(6);
      expect(values).toEqual([6]);

      s.dispose();
    });

    it('should support discrete opt-out', async () => {
      const s = scope(() => {
        const a = atom(0, { discrete: true });
        return { a };
      }, { strobe: 50 });

      const values: number[] = [];
      s.a.subscribe(v => values.push(v));

      s.a.next(1);
      s.a.next(2);

      expect(values).toEqual([1, 2]);

      s.dispose();
    });
  });

  describe('globalScope', () => {
    it('should default to discrete mode', () => {
      expect(globalScope!.mode).toBe('discrete');
      expect(globalScope!.strobe).toBe(0);
    });

    it('should make top-level scopes analog via global config', async () => {
      globalScope!.mode = 'analog';
      globalScope!.strobe = 50;

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

      await delay(70);
      expect(values).toEqual([3]);

      s.dispose();
    });

    it('should let child scopes override global analog mode', async () => {
      globalScope!.mode = 'analog';
      globalScope!.strobe = 50;

      const s = scope(() => {
        const a = atom(0);
        return { a };
      }, { mode: 'discrete' });

      const values: number[] = [];
      s.a.subscribe(v => values.push(v));

      s.a.next(1);
      s.a.next(2);

      expect(values).toEqual([1, 2]);

      s.dispose();
    });
  });
});
