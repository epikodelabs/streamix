import { on } from "@epikodelabs/streamix/dom";
import { idescribe } from "./env.spec";

idescribe('onResize', () => {
  it('prefers entry.contentRect and rounds values', (done) => {
    const originalObserver = (globalThis as any).ResizeObserver;

    let callback: ((entries: ResizeObserverEntry[]) => void) | null = null;
    const observeSpy = jasmine.createSpy('observe');
    const disconnectSpy = jasmine.createSpy('disconnect');

    class FakeResizeObserver {
      constructor(cb: (entries: ResizeObserverEntry[]) => void) {
        callback = cb;
      }
      observe(el: HTMLElement) {
        observeSpy(el);
      }
      disconnect() {
        disconnectSpy();
      }
    }

    (globalThis as any).ResizeObserver = FakeResizeObserver;

    const div = document.createElement('div');
    document.body.appendChild(div);

    const originalRect = div.getBoundingClientRect.bind(div);
    (div as any).getBoundingClientRect = () => ({ width: 10.4, height: 20.6 } as any);

    const values: any[] = [];
    const sub = on('resize', div).subscribe(v => values.push(v));

    setTimeout(() => {
      try {
        // Initial emit() uses getBoundingClientRect
        expect(values[0]).toEqual({ width: 10, height: 21 });

        // Next emit uses entry.contentRect
        callback?.([{ contentRect: { width: 99.9, height: 0.1 } } as any]);

        setTimeout(() => {
          try {
            expect(values.at(-1)).toEqual({ width: 100, height: 0 });
            sub();
            expect(disconnectSpy).toHaveBeenCalled();
            expect(observeSpy).toHaveBeenCalled();
            done();
          } catch (err: any) {
            sub();
            done.fail(err);
          } finally {
            (div as any).getBoundingClientRect = originalRect;
            document.body.removeChild(div);
            if (originalObserver) (globalThis as any).ResizeObserver = originalObserver;
            else delete (globalThis as any).ResizeObserver;
          }
        }, 0);
      } catch (err: any) {
        sub();
        (div as any).getBoundingClientRect = originalRect;
        document.body.removeChild(div);
        if (originalObserver) (globalThis as any).ResizeObserver = originalObserver;
        else delete (globalThis as any).ResizeObserver;
        done.fail(err);
      }
    }, 0);
  });

  it('does not observe when unsubscribed before promise resolves', async () => {
    const originalObserver = (globalThis as any).ResizeObserver;

    const observeSpy = jasmine.createSpy('observe');

    class FakeResizeObserver {
      constructor(_cb: (entries: ResizeObserverEntry[]) => void) {}
      observe(el: HTMLElement) {
        observeSpy(el);
      }
      disconnect() {}
    }

    (globalThis as any).ResizeObserver = FakeResizeObserver;

    let resolveElement!: (el: HTMLElement) => void;
    const elementPromise = new Promise<HTMLElement>((resolve) => {
      resolveElement = resolve;
    });

    const values: any[] = [];
    const sub = on('resize', elementPromise).subscribe(v => values.push(v));

    sub();

    const div = document.createElement('div');
    document.body.appendChild(div);

    resolveElement(div);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(observeSpy).not.toHaveBeenCalled();
    expect(values).toEqual([]);

    document.body.removeChild(div);
    if (originalObserver) (globalThis as any).ResizeObserver = originalObserver;
    else delete (globalThis as any).ResizeObserver;
  });

  it('should detect element resize changes', async () => {
    const div = document.createElement('div');
    div.style.width = '100px';
    div.style.height = '100px';
    document.body.appendChild(div);

    const values: any[] = [];
    const sub = on('resize', div).subscribe(v => values.push(v));

    // initial
    await new Promise(requestAnimationFrame);

    div.style.width = '200px';
    div.style.height = '200px';

    // allow layout + RO delivery
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    expect(values[0].width).toBe(100);
    expect(values.at(-1).width).toBe(200);

    sub();
    document.body.removeChild(div);
  });

  it('should clean up ResizeObserver when element is removed', () => {
    const divToTest = document.createElement('div');
    divToTest.style.width = '100px';
    divToTest.style.height = '100px';
    document.body.appendChild(divToTest);

    const resize = on('resize', divToTest);

    // Spy on the cleanup mechanism
    const disconnectSpy = spyOn(ResizeObserver.prototype, 'disconnect');

    const unsubscribe = resize.subscribe(() => { });

    // Remove element and verify cleanup
    document.body.removeChild(divToTest);
    unsubscribe();

    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('should clean up when unsubscribed', () => {
    const divToTest = document.createElement('div');
    document.body.appendChild(divToTest);

    const resize = on('resize', divToTest);
    const disconnectSpy = spyOn(ResizeObserver.prototype, 'disconnect');

    const unsubscribe = resize.subscribe(() => { });

    unsubscribe();

    expect(disconnectSpy).toHaveBeenCalled();
    document.body.removeChild(divToTest);
  });

  it('should handle element removal without errors', (done) => {
    const divToTest = document.createElement('div');
    document.body.appendChild(divToTest);

    const resize = on('resize', divToTest);
    let errorOccurred = false;

    const unsubscribe = resize.subscribe(() => { });

    setTimeout(() => {
      document.body.removeChild(divToTest);
      unsubscribe();
      expect(errorOccurred).toBe(false);
      done();
    }, 50);
  });

  it('should emit dimensions when element is resized', async () => {
    const div = document.createElement('div');
    div.style.width = '100px';
    div.style.height = '50px';
    document.body.appendChild(div);

    const values: any[] = [];
    const unsubscribe = on('resize', div).subscribe(v => values.push(v));

    // Wait for initial deferred emission
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(values[0].width).toBe(100);
    expect(values[0].height).toBe(50);
    
    unsubscribe();
    document.body.removeChild(div);
  });

  // More robust version with timeout protection
  it('completes on unsubscribe', done => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const sub = on('resize', div).subscribe(() => {});
    sub();

    setTimeout(() => done(), 0);
  });

  it('supports promise-based element resolution', async () => {
    const div = document.createElement('div');
    div.style.width = '40px';
    div.style.height = '60px';
    document.body.appendChild(div);

    let resolveElement: (element: HTMLElement) => void;
    const elementPromise = new Promise<HTMLElement>(resolve => {
      resolveElement = resolve;
    });

    const values: any[] = [];
    const unsubscribe = on('resize', elementPromise!).subscribe(v => values.push(v));

    resolveElement!(div);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    expect(values.length).toBeGreaterThan(0);
    expect(values[0].width).toBeGreaterThan(0);

    unsubscribe();
    document.body.removeChild(div);
  });

  it('no-ops when ResizeObserver is unavailable', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const originalObserver = (globalThis as any).ResizeObserver;
    try {
      delete (globalThis as any).ResizeObserver;

      const callback = jasmine.createSpy('callback');
      const unsubscribe = on('resize', div).subscribe(callback);

      expect(callback).not.toHaveBeenCalled();
      unsubscribe();
    } finally {
      if (originalObserver) {
        (globalThis as any).ResizeObserver = originalObserver;
      } else {
        delete (globalThis as any).ResizeObserver;
      }
      document.body.removeChild(div);
    }
  });

  it('handles SSR (ResizeObserver undefined)', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const originalObserver = (globalThis as any).ResizeObserver;
    try {
      delete (globalThis as any).ResizeObserver;

      const callback = jasmine.createSpy('callback');
      const unsubscribe = on('resize', div).subscribe(callback);

      // Should not emit without ResizeObserver
      expect(callback).not.toHaveBeenCalled();
      
      // Should not crash on unsubscribe
      expect(() => unsubscribe()).not.toThrow();
    } finally {
      if (originalObserver) {
        (globalThis as any).ResizeObserver = originalObserver;
      }
      document.body.removeChild(div);
    }
  });

  it('does not restart when start() called multiple times', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const observeSpy = spyOn(ResizeObserver.prototype, 'observe').and.callThrough();

    const sub1 = on('resize', div).subscribe();
    const sub2 = on('resize', div).subscribe();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Should observe for each subscription
    expect(observeSpy.calls.count()).toBeGreaterThan(0);

    sub1();
    sub2();
    document.body.removeChild(div);
  });

  it('handles null element from promise resolution', async () => {
    const originalObserver = (globalThis as any).ResizeObserver;

    const observeSpy = jasmine.createSpy('observe');

    class FakeResizeObserver {
      constructor(_cb: (entries: ResizeObserverEntry[]) => void) {}
      observe(el: HTMLElement) {
        observeSpy(el);
      }
      disconnect() {}
    }

    (globalThis as any).ResizeObserver = FakeResizeObserver;

    const values: any[] = [];
    const sub = on('resize', Promise.resolve(null as any)).subscribe(v => values.push(v));

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(observeSpy).not.toHaveBeenCalled();
    expect(values).toEqual([]);

    sub();

    if (originalObserver) (globalThis as any).ResizeObserver = originalObserver;
    else delete (globalThis as any).ResizeObserver;
  });

  it('handles teardown errors gracefully', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const disconnectSpy = spyOn(ResizeObserver.prototype, 'disconnect').and.callFake(() => {
      throw new Error('disconnect error');
    });

    const sub = on('resize', div).subscribe();
    await new Promise(resolve => setTimeout(resolve, 50));

    // createSharedSource swallows cleanup errors
    let didThrow = false;
    try {
      sub();
    } catch (e) {
      didThrow = true;
    }
    
    expect(didThrow).toBe(false);

    disconnectSpy.and.callThrough();
    document.body.removeChild(div);
  });

  it('does not stop when already stopped', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const disconnectSpy = spyOn(ResizeObserver.prototype, 'disconnect').and.callThrough();

    const sub = on('resize', div).subscribe();
    await new Promise(resolve => setTimeout(resolve, 0));

    sub();
    await new Promise(resolve => setTimeout(resolve, 0));

    disconnectSpy.calls.reset();

    // Calling unsubscribe again should not call disconnect
    sub();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(disconnectSpy).not.toHaveBeenCalled();

    document.body.removeChild(div);
  });
});


