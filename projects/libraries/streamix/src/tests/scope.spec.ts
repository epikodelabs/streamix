import { atom, createSubject, scope } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('scope', () => {
  it('should create a scope', () => {
    const s = scope(() => {});
    expect(s.parent).toBeUndefined();
    s.dispose();
  });

  it('should merge factory return value', () => {
    const s = scope(() => {
      const count = atom(createSubject<number>(), 0);
      return { count };
    });
    expect(s.count.value).toBe(0);
    s.dispose();
  });

  it('should auto-register atoms created inside factory', async () => {
    const subject = createSubject<number>();
    const s = scope(() => {
      const a = atom(subject, 0);
      return { a };
    });
    expect(s.a.disposed).toBeFalse();
    s.dispose();
    expect(s.a.disposed).toBeTrue();
  });

  it('should support snapshot', async () => {
    const s1 = createSubject<number>();
    const s2 = createSubject<number>();
    const s = scope(() => {
      const a = atom(s1, 1);
      const b = atom(s2, 2);
      return { a, b };
    });
    expect(s.snapshot()).toEqual([1, 2]);
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
          const x = atom(subject, 0);
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
        const a = atom(createSubject<number>(), 42);
        return { a };
      });
      return { child };
    });
    expect(s.snapshot()).toEqual([[42]]);
    s.dispose();
  });

  it('should react to stream emissions inside scope', async () => {
    const s1 = createSubject<number>();
    const s2 = createSubject<number>();
    const s = scope(() => {
      const a = atom(s1, 1);
      const b = atom(s2, 2);
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
});
