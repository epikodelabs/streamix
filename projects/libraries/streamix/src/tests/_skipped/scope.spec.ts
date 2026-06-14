import { atom, derived, flow, globalScope, scope } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('scope', () => {
  it('should create a scope', () => {
    const s = scope(() => {});
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

  it('should auto-register atoms created inside factory', async () => {
    const subject = atom<number>();
    const s = scope(() => {
      const a = flow(subject, 0);
      return { a };
    });
    expect(s.a.disposed).toBeFalse();
    s.dispose();
    expect(s.a.disposed).toBeTrue();
  });

  it('should support snapshot', async () => {
    const s1 = atom<number>();
    const s2 = atom<number>();
    const s = scope(() => {
      const a = flow(s1, 1);
      const b = flow(s2, 2);
      return { a, b };
    });
    expect(s.snapshot()).toEqual({ a: 1, b: 2 });
    s.dispose();
  });

  it('should create nested scopes', () => {
    const parent = scope(() => {
      const child = scope(() => {});
      return { child };
    });
    expect(parent.child.parent).toBe(parent);
    parent.dispose();
  });

  it('should dispose descendants recursively', () => {
    const subject = atom<number>();
    const parent = scope(() => {
      const child = scope(() => {
        const grandchild = scope(() => {
          const x = flow(subject, 0);
          return { x };
        });
        return { grandchild };
      });
      return { child };
    });

    expect(parent.child.grandchild.x.disposed).toBeFalse();
    parent.dispose();
    expect(parent.child.grandchild.x.disposed).toBeTrue();
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

  it('should react to stream emissions inside scope', async () => {
    const s1 = atom<number>();
    const s2 = atom<number>();
    const s = scope(() => {
      const a = flow(s1, 1);
      const b = flow(s2, 2);
      return { a, b };
    });

    const values: number[][] = [];
    s.a.subscribe(v => values.push(['a', v] as any));
    s.b.subscribe(v => values.push(['b', v] as any));
    await delay();

    s1.next(10);
    await delay();
    expect(s.a.value).toBe(10);

    s2.next(20);
    await delay();
    expect(s.b.value).toBe(20);

    s.dispose();
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
    });

    it('should track recursive loading through nested scopes', async () => {
      const subject = atom<number>();
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(subject, 0);
          return { a };
        });
        return { child };
      });

      expect(parent.loading).toBeTrue();

      subject.next(1);
      await delay();
      expect(parent.loading).toBeFalse();

      parent.dispose();
    });

    it('should become false when atom emits', async () => {
      const subject = atom<number>();
      const s = scope(() => {
        const a = flow(subject, 0);
        return { a };
      });

      expect(s.loading).toBeTrue();
      subject.next(1);
      await delay();
      expect(s.loading).toBeFalse();
      s.dispose();
    });
  });

  describe('strobe', () => {
    it('should sample flow emissions with scope strobe', async () => {
      const subject = atom<number>();
      const s = scope(() => {
        const a = flow(subject, 0);
        return { a };
      }, { strobe: 50 });

      const values: number[] = [];
      s.a.subscribe(v => values.push(v));

      subject.next(1);
      subject.next(2);
      subject.next(3);

      await delay(70);
      expect(s.a.value).toBe(3);
      expect(values).toContain(3);

      s.dispose();
    });

    it('should inherit strobe from parent scope', async () => {
      const subject = atom<number>();
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(subject, 0);
          return { a };
        });
        return { child };
      }, { strobe: 50 });

      subject.next(1);
      subject.next(2);

      await delay(70);
      expect(parent.child.a.value).toBe(2);

      parent.dispose();
    });

    it('should allow child scope to override parent strobe', async () => {
      const subject = atom<number>();
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(subject, 0);
          return { a };
        }, { strobe: 150 });
        return { child };
      }, { strobe: 50 });

      subject.next(1);
      subject.next(2);

      await delay(70);
      // Child uses 150ms strobe, so it should not have sampled yet
      expect(parent.child.a.value).toBe(0);

      await delay(100);
      // Total ~170ms, child's strobe should have fired
      expect(parent.child.a.value).toBe(2);

      parent.dispose();
    });

    it('should stop sampling when scope is disposed', async () => {
      const subject = atom<number>();
      const s = scope(() => {
        const a = flow(subject, 0);
        return { a };
      }, { strobe: 50 });

      s.dispose();

      subject.next(1);
      subject.next(2);

      await delay(70);
      expect(s.a.safeValue).toBe(0);

      expect(() => s.a.value).toThrowError();
    });

    it('should batch atom set() calls on strobe', async () => {
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

      // In analog mode the derived value is sampled; it stays at the
      // last-emitted value until the strobe fires.
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

    it('should batch asyncAtom set() calls on strobe', async () => {
      const s = scope(() => {
        const a = atom<number>();
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
  });

  describe('globalScope', () => {
    afterEach(() => {
      globalScope!.mode = 'discrete';
      globalScope!.strobe = 0;
    });

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
