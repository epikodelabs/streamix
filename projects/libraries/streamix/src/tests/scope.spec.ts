import { createBehaviorSubject, createSubject, flow, scope, startWith } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('scope', () => {
  it('should create a scope', () => {
    const s = scope(() => {});
    expect(s.parent).toBeUndefined();
    s.dispose();
  });

  it('should merge factory return value', async () => {
    const s = scope(() => {
      const count = flow(createSubject<number>().pipe(startWith(0)));
      return { count };
    });
    await delay();
    expect(s.count.value).toBe(0);
    s.dispose();
  });

  it('should auto-register atoms created inside factory', async () => {
    const subject = createSubject<number>();
    const s = scope(() => {
      const a = flow(subject);
      return { a };
    });
    expect(s.a.disposed).toBeFalse();
    s.dispose();
    expect(s.a.disposed).toBeTrue();
  });

  it('should support snapshot', async () => {
    const s1 = createSubject<number>().pipe(startWith(1));
    const s2 = createSubject<number>().pipe(startWith(2));
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
    const subject = createSubject<number>();
    const parent = scope(() => {
      const child = scope(() => {
        const grandchild = scope(() => {
          const x = flow(subject);
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
        const a = flow(createSubject<number>().pipe(startWith(42)));
        return { a };
      });
      return { child };
    });
    await delay();
    expect(s.snapshot()).toEqual({ child: { a: 42 } });
    s.dispose();
  });

  it('should react to stream emissions inside scope', async () => {
    const s1 = createBehaviorSubject<number>(1);
    const s2 = createBehaviorSubject<number>(2);
    const s = scope(() => {
      const a = flow(s1);
      const b = flow(s2);
      return { a, b };
    });

    const values: number[][] = [];
    await delay();
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
      const s1 = createSubject<number>();
      const s2 = createSubject<string>();
      const s = scope(() => {
        const a = flow(s1);
        const b = flow(s2);
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
      const subject = createSubject<number>();
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(subject);
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
      const subject = createSubject<number>();
      const s = scope(() => {
        const a = flow(subject);
        return { a };
      });

      expect(s.loading).toBeTrue();
      subject.next(1);
      await delay();
      expect(s.loading).toBeFalse();
      s.dispose();
    });
  });
});
