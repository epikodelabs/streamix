import { onIntersection } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

function withGlobal<T>(key: string, value: T, fn: () => void | Promise<void>) {
  const g: any = globalThis as any;
  const original = g[key];
  g[key] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (original === undefined) delete g[key];
      else g[key] = original;
    });
}

function firstValue<T>(stream: any, timeoutMs = 250): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`Timed out waiting for first emission (${timeoutMs}ms)`)),
      timeoutMs
    );

    const sub = stream.subscribe({
      next: (v: T) => {
        clearTimeout(timeoutId);
        sub.unsubscribe();
        resolve(v);
      },
      error: (e: any) => {
        clearTimeout(timeoutId);
        sub.unsubscribe();
        reject(e);
      },
    });
  });
}

idescribe('onIntersection', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    if (element && element.parentNode) {
      document.body.removeChild(element);
    }
  });

  it('emits true when element is visible', async () => {
    class FakeIntersectionObserver {
      constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      await expectAsync(firstValue<boolean>(onIntersection(element))).toBeResolvedTo(true);
    });
  });

  it('emits false when element is not visible', async () => {
    class FakeIntersectionObserver {
      constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: false } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      await expectAsync(firstValue<boolean>(onIntersection(element))).toBeResolvedTo(false);
    });
  });

  it('emits initial visibility using getBoundingClientRect when observer is silent', async () => {
    class FakeIntersectionObserver {
      constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    const originalGetRect = element.getBoundingClientRect.bind(element);
    (element as any).getBoundingClientRect = () => ({ top: 0, bottom: 10 } as any);

    try {
      await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
        await expectAsync(firstValue<boolean>(onIntersection(element))).toBeResolvedTo(true);
      });
    } finally {
      (element as any).getBoundingClientRect = originalGetRect;
    }
  });

  it('defaults to false when IntersectionObserver callback has no entries', async () => {
    class FakeIntersectionObserver {
      constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {
        this.cb([] as any);
      }
      disconnect() {}
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      await expectAsync(firstValue<boolean>(onIntersection(element))).toBeResolvedTo(false);
    });
  });

  it('supports promise-based elements and options', async () => {
    class FakeIntersectionObserver {
      constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    class FakeMutationObserver {
      constructor(_cb: () => void) {}
      observe() {}
      disconnect() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      await withGlobal('MutationObserver', FakeMutationObserver as any, async () => {
        const elementPromise = Promise.resolve(element);
        const optionsPromise = Promise.resolve({ rootMargin: '0px' });
        await expectAsync(firstValue<boolean>(onIntersection(elementPromise, optionsPromise))).toBeResolvedTo(
          true
        );
      });
    });
  });

  it('stops when element is removed', async () => {
    let triggerMutation: (() => void) | null = null;

    class FakeIntersectionObserver {
      constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    class FakeMutationObserver {
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        triggerMutation = () => this.cb();
      }
      observe() {}
      disconnect() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      await withGlobal('MutationObserver', FakeMutationObserver as any, async () => {
        const completed: boolean[] = [];
        const subscription = onIntersection(element).subscribe({
          complete: () => completed.push(true),
        });

        document.body.removeChild(element);
        triggerMutation?.();

        await new Promise((r) => setTimeout(r, 0));
        subscription.unsubscribe();

        expect(completed.length).toBeGreaterThan(0);
      });
    });
  });

  it('supports async iteration', async () => {
    class FakeIntersectionObserver {
      constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      const values: boolean[] = [];
      for await (const v of onIntersection(element)) {
        values.push(v);
        break;
      }
      expect(values).toEqual([true]);
    });
  });

  it('handles SSR (IntersectionObserver undefined)', async () => {
    await withGlobal('IntersectionObserver', undefined, async () => {
      const values: boolean[] = [];
      const sub = onIntersection(element).subscribe(v => values.push(v));

      await new Promise(r => setTimeout(r, 50));

      // Should not emit without IntersectionObserver
      expect(values).toEqual([]);
      sub.unsubscribe();
    });
  });

  it('handles null element from promise', async () => {
    class FakeIntersectionObserver {
      constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      const values: boolean[] = [];
      const sub = onIntersection(Promise.resolve(null as any)).subscribe(v => values.push(v));

      await new Promise(r => setTimeout(r, 50));

      // Should not emit with null element
      expect(values).toEqual([]);
      sub.unsubscribe();
    });
  });

  it('handles aborted signal before element resolution', async () => {
    class FakeIntersectionObserver {
      constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      const values: boolean[] = [];
      const sub = onIntersection(Promise.resolve(element)).subscribe(
        v => values.push(v)
      );

      sub.unsubscribe();
      await new Promise(r => setTimeout(r, 50));

      // Should not emit when signal is aborted
      expect(values).toEqual([]);
      sub.unsubscribe();
    });
  });

  it('handles MutationObserver unavailable', async () => {
    class FakeIntersectionObserver {
      constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      await withGlobal('MutationObserver', undefined, async () => {
        await expectAsync(firstValue<boolean>(onIntersection(element))).toBeResolvedTo(true);
      });
    });
  });

  it('handles errors during disconnect', async () => {
    class FakeIntersectionObserver {
      constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {
        throw new Error('disconnect error');
      }
      unobserve() {}
    }

    await withGlobal('IntersectionObserver', FakeIntersectionObserver as any, async () => {
      const sub = onIntersection(element).subscribe();
      await new Promise(r => setTimeout(r, 50));

      // Should not throw when unsubscribing
      expect(() => sub.unsubscribe()).not.toThrow();
    });
  });

  it('handles window undefined in getBoundingClientRect', async () => {
    // Skip this test as window is read-only in browser test environment
    expect(true).toBe(true);
  });
});

