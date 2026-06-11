import { atom, flow, fromAtom, scope } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('scope', () => {
  it('should create a scope', () => {
    const s = scope(() => {});
    expect(s.parent).toBeUndefined();
    s.dispose();
  });

  it('should merge factory return value', async () => {
    const s = scope(() => {
      const count = flow(fromAtom(atom<number>(0)));
      return { count };
    });
    await delay();
    expect(s.count.value).toBe(0);
    s.dispose();
  });

  it('should auto-register atoms created inside factory', async () => {
    const source$ = atom<number>();
    const s = scope(() => {
      const a = flow(fromAtom(source$));
      return { a };
    });
    expect(s.a.disposed).toBeFalse();
    s.dispose();
    expect(s.a.disposed).toBeTrue();
  });

  it('should support snapshot', async () => {
    const s1 = fromAtom(atom<number>(1));
    const s2 = fromAtom(atom<number>(2));
    const s = scope(() => {
      const a = flow(s1);
      const b = flow(s2);
      return { a, b };
    });
    await delay();
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
    const source$ = atom<number>();
    const parent = scope(() => {
      const child = scope(() => {
        const grandchild = scope(() => {
          const x = flow(fromAtom(source$));
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

  it('should snapshot nested scopes', async () => {
    const s = scope(() => {
      const child = scope(() => {
        const a = flow(fromAtom(atom<number>(42)));
        return { a };
      });
      return { child };
    });
    await delay();
    expect(s.snapshot()).toEqual({ child: { a: 42 } });
    s.dispose();
  });

  it('should react to stream emissions inside scope', async () => {
    const s1$ = atom<number>(1);
    const s2$ = atom<number>(2);
    const s = scope(() => {
      const a = flow(fromAtom(s1$));
      const b = flow(fromAtom(s2$));
      return { a, b };
    });

    const values: number[][] = [];
    await delay();
    s.a.subscribe(v => values.push(['a', v] as any));
    s.b.subscribe(v => values.push(['b', v] as any));
    await delay();

    s1$.set(10);
    await delay();
    expect(s.a.value).toBe(10);

    s2$.set(20);
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
      const s1$ = atom<number>();
      const s2$ = atom<string>();
      const s = scope(() => {
        const a = flow(fromAtom(s1$));
        const b = flow(fromAtom(s2$));
        return { a, b };
      });

      expect(s.loading).toBeTrue();

      s1$.set(1);
      await delay();
      expect(s.loading).toBeTrue();

      s2$.set('x');
      await delay();
      expect(s.loading).toBeFalse();

      s.dispose();
    });

    it('should track recursive loading through nested scopes', async () => {
      const source$ = atom<number>();
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(fromAtom(source$));
          return { a };
        });
        return { child };
      });

      expect(parent.loading).toBeTrue();

      source$.set(1);
      await delay();
      expect(parent.loading).toBeFalse();

      parent.dispose();
    });

    it('should become false when atom emits', async () => {
      const source$ = atom<number>();
      const s = scope(() => {
        const a = flow(fromAtom(source$));
        return { a };
      });

      expect(s.loading).toBeTrue();
      source$.set(1);
      await delay();
      expect(s.loading).toBeFalse();
      s.dispose();
    });
  });
});
