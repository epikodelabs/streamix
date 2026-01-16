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
    element.style.height = '100px';
    element.style.width = '100px';
    element.style.background = 'red';
    element.style.position = 'absolute';
    element.style.top = '500px';

    visibilityStream = onIntersection(element);

    const emittedValues: boolean[] = [];
    const subscription = visibilityStream.subscribe({
      next: (isVisible: boolean) => {
        emittedValues.push(isVisible);
      },
      complete: () => {
        subscription.unsubscribe();
      }
    });

    setTimeout(() => {
      expect(emittedValues).toContain(true);
      done();
    }, 100);
  });

  it('should emit false when element is scrolled out of view', async () => {
    element.style.height = '100px';
    element.style.width = '100px';
    element.style.background = 'blue';
    element.style.position = 'absolute';
    element.style.top = '-1000px';

    visibilityStream = onIntersection(element);

    const emittedValues: boolean[] = [];
    visibilityStream.subscribe({
      next: (isVisible: boolean) => {
        emittedValues.push(isVisible);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(emittedValues).toContain(false);
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
});


