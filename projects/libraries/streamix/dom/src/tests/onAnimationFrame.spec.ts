import { takeWhile } from '@epikodelabs/streamix';
import { onAnimationFrame } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

idescribe('onAnimationFrame', () => {

  it('should emit delta values with reasonable time intervals', async () => {
    const stream = onAnimationFrame();
    const emittedDeltas: number[] = [];
    let count = 0;

    const subscription = stream.pipe(takeWhile(() => count < 5)).subscribe({
      next: (delta: number) => {
        count++;
        emittedDeltas.push(delta);
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(emittedDeltas.length).toBe(5);
      // Each delta should be a positive number (milliseconds between frames)
      emittedDeltas.forEach(delta => {
        expect(delta).toBeGreaterThanOrEqual(0);
        expect(typeof delta).toBe('number');
      });
      // Deltas should be reasonable for a timeout-based fallback (around 16ms per frame)
      const avgDelta = emittedDeltas.reduce((a, b) => a + b, 0) / emittedDeltas.length;
      expect(avgDelta).toBeGreaterThan(5);
    } finally {
      subscription.unsubscribe();
    }
  });

  it('should stop emitting when condition is met', (done) => {
    const stream = onAnimationFrame().pipe(takeWhile((_, index) => index < 5));
    const emittedCount: number[] = [];

    const subscription = stream.subscribe({
      next: (delta: number) => {
        expect(delta).toBeGreaterThanOrEqual(0);
        emittedCount.push(delta);
      },
      complete: () => {
        // Should have received exactly 5 emissions before the condition became false
        expect(emittedCount.length).toBe(5);
        expect(() => subscription.unsubscribe()).not.toThrow();
        done();
      },
    });
  });

  it('should emit multiple times when condition allows', async () => {
    const stream = onAnimationFrame().pipe(takeWhile((_, index) => index < 10));
    const emittedDeltas: number[] = [];

    const subscription = stream.subscribe({
      next: (delta: number) => {
        emittedDeltas.push(delta);
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have emitted 10 times with real delta values
      expect(emittedDeltas.length).toBe(10);
      emittedDeltas.forEach(delta => {
        expect(typeof delta).toBe('number');
        expect(delta).toBeGreaterThanOrEqual(0);
      });
    } finally {
      subscription.unsubscribe();
    }
  });

  it('should cancel animation frame on unsubscribe', (done) => {
    const originalRAF = (globalThis as any).requestAnimationFrame;
    const originalCancel = (globalThis as any).cancelAnimationFrame;
    const requestedIds: number[] = [];
    let cancelledIds: number[] = [];
    let frameCounter = 0;

    // Mock RAF to capture the ID and invoke the callback
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = frameCounter++;
      requestedIds.push(id);
      // Invoke callback once immediately to ensure frame loop starts
      if (requestedIds.length === 1) {
        cb(performance.now());
      }
      // Return the ID (don't actually schedule more frames)
      return id;
    };

    // Mock cancel to track calls
    (globalThis as any).cancelAnimationFrame = (id: number) => {
      cancelledIds.push(id);
    };

    const stream = onAnimationFrame();
    const subscription = stream.subscribe(() => {});

    // Give it a moment for the RAF to be called
    setTimeout(() => {
      subscription.unsubscribe();
      expect(cancelledIds.length).toBeGreaterThan(0);
      expect(requestedIds.length).toBeGreaterThan(0);
      
      // Restore originals
      (globalThis as any).requestAnimationFrame = originalRAF;
      (globalThis as any).cancelAnimationFrame = originalCancel;
      done();
    }, 0);
  });

  it('should share the same RAF loop for multiple subscribers', async () => {
    const valuesA: number[] = [];
    const valuesB: number[] = [];

    const stream = onAnimationFrame();

    const subA = stream.subscribe(v => valuesA.push(v));
    const subB = stream.subscribe(v => valuesB.push(v));

    await new Promise(res => setTimeout(res, 100));

    subA.unsubscribe();
    subB.unsubscribe();

    // Both subscribers should have received real delta values
    expect(valuesA.length).toBeGreaterThan(0);
    expect(valuesB.length).toBeGreaterThan(0);
    
    // Delta values should be reasonable numbers
    valuesA.forEach(v => {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    });
    valuesB.forEach(v => {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    });
  });

  it('falls back to setTimeout when RAF is unavailable', async () => {
    const originalRAF = (globalThis as any).requestAnimationFrame;
    const originalCancelRAF = (globalThis as any).cancelAnimationFrame;

    // Remove RAF to force fallback
    (globalThis as any).requestAnimationFrame = undefined;
    (globalThis as any).cancelAnimationFrame = undefined;

    const emittedDeltas: number[] = [];
    let setTimeoutCallCount = 0;
    let clearTimeoutCallCount = 0;

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;

    // Track setTimeout/clearTimeout calls
    (globalThis as any).setTimeout = function (
      ...args: Parameters<typeof originalSetTimeout>
    ): ReturnType<typeof originalSetTimeout> {
      setTimeoutCallCount++;
      return originalSetTimeout(...args);
    };

    (globalThis as any).clearTimeout = function (
      ...args: Parameters<typeof originalClearTimeout>
    ): ReturnType<typeof originalClearTimeout> {
      clearTimeoutCallCount++;
      return originalClearTimeout(...args);
    };

    try {
      const stream = onAnimationFrame();
      const subscription = stream.subscribe((delta: number) => {
        emittedDeltas.push(delta);
      });

      await new Promise(resolve => originalSetTimeout(resolve, 100));

      subscription.unsubscribe();
      await new Promise(resolve => originalSetTimeout(resolve, 10));

      // Should have emitted deltas using setTimeout fallback
      expect(emittedDeltas.length).toBeGreaterThan(0);
      emittedDeltas.forEach(delta => {
        expect(typeof delta).toBe('number');
      });
      
      // setTimeout should have been called to set up the loop
      expect(setTimeoutCallCount).toBeGreaterThan(0);
      // clearTimeout should have been called on unsubscribe
      expect(clearTimeoutCallCount).toBeGreaterThan(0);
    } finally {
      (globalThis as any).requestAnimationFrame = originalRAF;
      (globalThis as any).cancelAnimationFrame = originalCancelRAF;
      (globalThis as any).setTimeout = originalSetTimeout;
      (globalThis as any).clearTimeout = originalClearTimeout;
    }
  });

  it('uses clearTimeout for cancellation when RAF exists but cancelAnimationFrame is missing', (done) => {
    const originalRAF = (globalThis as any).requestAnimationFrame;
    const originalCancel = (globalThis as any).cancelAnimationFrame;
    const originalClearTimeout = (globalThis as any).clearTimeout;

    const clearSpy = jasmine.createSpy('clearTimeout').and.callFake(originalClearTimeout);
    (globalThis as any).clearTimeout = clearSpy;

    // RAF exists, but cancelAnimationFrame is missing => cancelFrame falls back to clearTimeout.
    (globalThis as any).cancelAnimationFrame = undefined;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      return globalThis.setTimeout(() => cb(performance.now()), 0) as any;
    };

    const subscription = onAnimationFrame().subscribe();

    setTimeout(() => {
      subscription.unsubscribe();
      expect(clearSpy).toHaveBeenCalled();

      (globalThis as any).requestAnimationFrame = originalRAF;
      (globalThis as any).cancelAnimationFrame = originalCancel;
      (globalThis as any).clearTimeout = originalClearTimeout;
      done();
    }, 10);
  });

  it('clamps non-monotonic RAF timestamps to 0-delta frames', (done) => {
    const originalRAF = (globalThis as any).requestAnimationFrame;
    const originalCancel = (globalThis as any).cancelAnimationFrame;

    const times = [100, 90, 110];
    let i = 0;

    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = i + 1;
      if (i < times.length) {
        const t = times[i++];
        queueMicrotask(() => cb(t));
      }
      return id;
    };

    (globalThis as any).cancelAnimationFrame = jasmine.createSpy('cancelAnimationFrame');

    const deltas: number[] = [];
    const subscription = onAnimationFrame().subscribe({
      next: (delta: number) => {
        deltas.push(delta);
        if (deltas.length === 3) {
          try {
            // First tick is always 0, second is non-monotonic => 0, third is 110-100 => 10
            expect(deltas).toEqual([0, 0, 10]);
            subscription.unsubscribe();
            (globalThis as any).requestAnimationFrame = originalRAF;
            (globalThis as any).cancelAnimationFrame = originalCancel;
            done();
          } catch (err: any) {
            subscription.unsubscribe();
            (globalThis as any).requestAnimationFrame = originalRAF;
            (globalThis as any).cancelAnimationFrame = originalCancel;
            done.fail(err);
          }
        }
      },
    });
  });
});


