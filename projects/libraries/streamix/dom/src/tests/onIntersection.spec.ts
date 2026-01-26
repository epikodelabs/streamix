import { onIntersection } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

idescribe('onIntersection', () => {
  let element: HTMLElement;
  let visibilityStream: any;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    if (element && element.parentNode) {
      document.body.removeChild(element);
    }
    if (visibilityStream && visibilityStream.unsubscribe) {
        visibilityStream.unsubscribe();
    }
  });

  it('should emit true when element is visible', (done) => {
    const originalIntersection = (globalThis as any).IntersectionObserver;

    class FakeIntersectionObserver {
      callback: (entries: IntersectionObserverEntry[]) => void;
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.callback = cb;
      }
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    const restore = () => {
      if (originalIntersection) {
        (globalThis as any).IntersectionObserver = originalIntersection;
      } else {
        delete (globalThis as any).IntersectionObserver;
      }
    };

    let timeoutId: any;
    const subscription = onIntersection(element).subscribe({
      next: (isVisible: boolean) => {
        if (isVisible) {
          expect(isVisible).toBeTrue();
          subscription.unsubscribe();
          clearTimeout(timeoutId);
          restore();
          done();
        }
      }
    });

    timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      restore();
      fail('Expected onIntersection to emit true');
    }, 100);
  });

  it('should emit false when element is scrolled out of view', (done) => {
    const originalIntersection = (globalThis as any).IntersectionObserver;

    class FakeIntersectionObserver {
      callback: (entries: IntersectionObserverEntry[]) => void;
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.callback = cb;
      }
      observe() {
        this.callback([{ isIntersecting: false } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    const restore = () => {
      if (originalIntersection) {
        (globalThis as any).IntersectionObserver = originalIntersection;
      } else {
        delete (globalThis as any).IntersectionObserver;
      }
    };

    let timeoutId: any;
    const subscription = onIntersection(element).subscribe({
      next: (isVisible: boolean) => {
        expect(isVisible).toBeFalse();
        subscription.unsubscribe();
        clearTimeout(timeoutId);
        restore();
        done();
      }
    });

    timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      restore();
      fail('Expected onIntersection to emit false');
    }, 100);
  });

  it('should properly clean up observer when element is removed', async () => {
    element.style.height = '100px';
    element.style.width = '100px';
    element.style.background = 'green';
    element.style.position = 'absolute';
    element.style.top = '500px';

    visibilityStream = onIntersection(element);

    const subscription = visibilityStream.subscribe(()=>{});

    await new Promise((resolve) => setTimeout(resolve, 100));

    document.body.removeChild(element);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(subscription.unsubscribed).toBe(true);
  });

  it('supports promise-based elements and options', async () => {
    const element = document.createElement('div');
    document.body.appendChild(element);

    const originalIntersection = (globalThis as any).IntersectionObserver;
    const originalMutation = (globalThis as any).MutationObserver;

    class FakeIntersectionObserver {
      callback: (entries: IntersectionObserverEntry[]) => void;

      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.callback = cb;
      }

      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }

      disconnect() {}
      unobserve() {}
    }

    class FakeMutationObserver {
      observe() {}
      disconnect() {}
    }

    try {
      (globalThis as any).IntersectionObserver = FakeIntersectionObserver;
      (globalThis as any).MutationObserver = FakeMutationObserver;

      const elementPromise = new Promise<HTMLElement>(resolve => setTimeout(() => resolve(element), 0));
      const optionsPromise = new Promise<IntersectionObserverInit>(resolve =>
        setTimeout(() => resolve({ rootMargin: '0px' }), 0)
      );

      const callback = jasmine.createSpy('callback');
      const stream = onIntersection(elementPromise, optionsPromise);
      stream.subscribe(callback);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalledWith(true);
    } finally {
      if (originalIntersection) {
        (globalThis as any).IntersectionObserver = originalIntersection;
      } else {
        delete (globalThis as any).IntersectionObserver;
      }

      if (originalMutation) {
        (globalThis as any).MutationObserver = originalMutation;
      } else {
        delete (globalThis as any).MutationObserver;
      }

      document.body.removeChild(element);
    }
  });

  it('emits initial visibility using getBoundingClientRect in the sync path', (done) => {
    const originalIntersection = (globalThis as any).IntersectionObserver;

    class FakeIntersectionObserver {
      constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    const originalGetRect = element.getBoundingClientRect.bind(element);
    (element as any).getBoundingClientRect = () =>
      ({ top: 0, bottom: 10 } as any);

    const restore = () => {
      (element as any).getBoundingClientRect = originalGetRect;
      if (originalIntersection) {
        (globalThis as any).IntersectionObserver = originalIntersection;
      } else {
        delete (globalThis as any).IntersectionObserver;
      }
    };

    let timeoutId: any;
    const subscription = onIntersection(element).subscribe({
      next: (isVisible: boolean) => {
        expect(isVisible).toBeTrue();
        clearTimeout(timeoutId);
        subscription.unsubscribe();
        restore();
        done();
      }
    });

    timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      restore();
      fail('Expected initial visibility emission');
    }, 100);
  });

  it('defaults to false when IntersectionObserver callback has no entries', (done) => {
    const originalIntersection = (globalThis as any).IntersectionObserver;

    class FakeIntersectionObserver {
      callback: (entries: IntersectionObserverEntry[]) => void;
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.callback = cb;
      }
      observe() {
        this.callback([] as any);
      }
      disconnect() {}
      unobserve() {}
    }

    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    const restore = () => {
      if (originalIntersection) {
        (globalThis as any).IntersectionObserver = originalIntersection;
      } else {
        delete (globalThis as any).IntersectionObserver;
      }
    };

    let timeoutId: any;
    const subscription = onIntersection(element).subscribe({
      next: (isVisible: boolean) => {
        expect(isVisible).toBeFalse();
        clearTimeout(timeoutId);
        subscription.unsubscribe();
        restore();
        done();
      }
    });

    timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      restore();
      fail('Expected onIntersection to emit false for empty entries');
    }, 100);
  });

  it('supports mixed promise inputs (element sync, options async)', async () => {
    const originalIntersection = (globalThis as any).IntersectionObserver;
    const originalMutation = (globalThis as any).MutationObserver;

    class FakeIntersectionObserver {
      callback: (entries: IntersectionObserverEntry[]) => void;
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.callback = cb;
      }
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    class FakeMutationObserver {
      observe() {}
      disconnect() {}
    }

    try {
      (globalThis as any).IntersectionObserver = FakeIntersectionObserver;
      (globalThis as any).MutationObserver = FakeMutationObserver;

      const optionsPromise = Promise.resolve({ rootMargin: '0px' });
      const callback = jasmine.createSpy('callback');
      onIntersection(element, optionsPromise).subscribe(callback);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledWith(true);
    } finally {
      if (originalIntersection) (globalThis as any).IntersectionObserver = originalIntersection;
      else delete (globalThis as any).IntersectionObserver;

      if (originalMutation) (globalThis as any).MutationObserver = originalMutation;
      else delete (globalThis as any).MutationObserver;
    }
  });

  it('supports mixed promise inputs (element async, options sync)', async () => {
    const originalIntersection = (globalThis as any).IntersectionObserver;
    const originalMutation = (globalThis as any).MutationObserver;

    class FakeIntersectionObserver {
      callback: (entries: IntersectionObserverEntry[]) => void;
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.callback = cb;
      }
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    class FakeMutationObserver {
      observe() {}
      disconnect() {}
    }

    try {
      (globalThis as any).IntersectionObserver = FakeIntersectionObserver;
      (globalThis as any).MutationObserver = FakeMutationObserver;

      const elementPromise = Promise.resolve(element);
      const callback = jasmine.createSpy('callback');
      onIntersection(elementPromise, { rootMargin: '0px' }).subscribe(callback);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledWith(true);
    } finally {
      if (originalIntersection) (globalThis as any).IntersectionObserver = originalIntersection;
      else delete (globalThis as any).IntersectionObserver;

      if (originalMutation) (globalThis as any).MutationObserver = originalMutation;
      else delete (globalThis as any).MutationObserver;
    }
  });

  it('supports async iteration', async () => {
    const originalIntersection = (globalThis as any).IntersectionObserver;

    class FakeIntersectionObserver {
      callback: (entries: IntersectionObserverEntry[]) => void;
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.callback = cb;
      }
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
      disconnect() {}
      unobserve() {}
    }

    try {
      (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

      const values: boolean[] = [];
      for await (const v of onIntersection(element)) {
        values.push(v);
        break;
      }

      expect(values).toEqual([true]);
    } finally {
      if (originalIntersection) {
        (globalThis as any).IntersectionObserver = originalIntersection;
      } else {
        delete (globalThis as any).IntersectionObserver;
      }
    }
  });
});


