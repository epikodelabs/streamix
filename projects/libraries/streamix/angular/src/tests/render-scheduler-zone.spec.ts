import {
  animationFrameRenderScheduler,
  RendererScheduler,
  createOutsideAngularRenderScheduler,
  type CancelRender,
  type RenderScheduler,
} from '../lib/render-scheduler';

class ManualScheduler implements RenderScheduler {
  callback?: () => void;

  schedule(callback: () => void): CancelRender {
    this.callback = callback;
    return () => {
      if (this.callback === callback) {
        this.callback = undefined;
      }
    };
  }

  flush(): void {
    const callback = this.callback;
    this.callback = undefined;
    callback?.();
  }
}

class SynchronousScheduler implements RenderScheduler {
  schedule(callback: () => void): CancelRender {
    callback();

    return () => {};
  }
}

describe('outside-Angular renderer scheduling', () => {
  it('schedules and executes renderer work through the outside boundary', () => {
    const delegate = new ManualScheduler();
    let depth = 0;
    let registrationsOutside = 0;
    let boundaryEntries = 0;

    const scheduler = createOutsideAngularRenderScheduler(
      {
        runOutsideAngular<T>(callback: () => T): T {
          boundaryEntries += 1;
          depth += 1;
          try {
            return callback();
          } finally {
            depth -= 1;
          }
        },
      },
      {
        schedule(callback) {
          if (depth > 0) registrationsOutside += 1;
          return delegate.schedule(callback);
        },
      },
    );

    const renderer = new RendererScheduler(scheduler);
    let flushes = 0;
    let flushDepth = 0;
    const binding = renderer.register(() => {
      flushDepth = depth;
      flushes += 1;
    });

    binding.markDirty();
    delegate.flush();

    expect(registrationsOutside).toBe(1);
    expect(boundaryEntries).toBe(2);
    expect(flushDepth).toBeGreaterThan(0);
    expect(flushes).toBe(1);
  });

  it('reschedules pending work when the renderer scheduler boundary changes', () => {
    const first = new ManualScheduler();
    const second = new ManualScheduler();
    const renderer = new RendererScheduler(first);
    let flushes = 0;

    const binding = renderer.register(() => { flushes += 1; });
    binding.markDirty();

    renderer.setScheduler(second);

    first.flush();
    expect(flushes).toBe(0);

    second.flush();
    expect(flushes).toBe(1);
  });

  it('keeps flushing when the scheduler invokes its callback synchronously', () => {
    const renderer = new RendererScheduler(new SynchronousScheduler());
    const calls: number[] = [];

    const binding = renderer.register(() => calls.push(1));

    binding.markDirty();
    expect(calls).toEqual([1]);

    // A synchronous scheduler consumes the frame before schedule() returns.
    // Storing the stale cancel handle would leave every later markDirty()
    // believing a frame is pending, and this second flush would never run.
    binding.markDirty();
    expect(calls).toEqual([1, 1]);
  });

  it('drains work a flush re-queues under a synchronous scheduler', () => {
    const renderer = new RendererScheduler(new SynchronousScheduler());
    let runs = 0;

    const binding = renderer.register(() => {
      runs += 1;
      if (runs === 1) {
        binding.markDirty();
      }
    });

    binding.markDirty();

    expect(runs).toBe(2);

    // The stale-handle defect would also wedge later flushes.
    binding.markDirty();
    expect(runs).toBe(3);
  });

  it('restores the default scheduler only while the released scheduler owns it', () => {
    jasmine.clock().install();
    const request = spyOn(window, 'requestAnimationFrame').and.returnValue(1);
    const cancel = spyOn(window, 'cancelAnimationFrame');

    try {
      const manual = new ManualScheduler();
      const renderer = new RendererScheduler(manual);
      let flushes = 0;

      const binding = renderer.register(() => { flushes += 1; });

      // Releasing a scheduler that was never installed changes nothing.
      renderer.restoreScheduler(animationFrameRenderScheduler);
      binding.markDirty();
      manual.flush();
      expect(flushes).toBe(1);

      // Releasing the installed scheduler returns to the default frame
      // scheduler and moves pending work onto it.
      binding.markDirty();
      renderer.restoreScheduler(manual);

      manual.flush();
      expect(flushes).toBe(1);
      expect(request).toHaveBeenCalled();

      jasmine.clock().tick(100);
      expect(flushes).toBe(2);
      expect(cancel).toHaveBeenCalledWith(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  describe('Zone.js diagnostics', () => {
    const globalWithZone = globalThis as { Zone?: unknown };
    const originalZone = globalWithZone.Zone;

    afterEach(() => {
      if (originalZone === undefined) {
        delete globalWithZone.Zone;
      } else {
        globalWithZone.Zone = originalZone;
      }
    });

    it('warns once when a zone application schedules without opting in', () => {
      globalWithZone.Zone = { current: {} };
      const warn = spyOn(console, 'warn');
      const renderer = new RendererScheduler(new ManualScheduler());

      const binding = renderer.register(() => {});
      binding.markDirty();
      binding.markDirty();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.calls.mostRecent().args[0]).toContain(
        'provideSxZoneScheduling()',
      );
    });

    it('does not warn once outside-zone scheduling is installed', () => {
      globalWithZone.Zone = { current: {} };
      const warn = spyOn(console, 'warn');
      const renderer = new RendererScheduler(new ManualScheduler());

      renderer.setScheduler(
        createOutsideAngularRenderScheduler({
          runOutsideAngular: callback => callback(),
        }),
      );

      const binding = renderer.register(() => {});
      binding.markDirty();

      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn without a global Zone', () => {
      delete globalWithZone.Zone;
      const warn = spyOn(console, 'warn');
      const renderer = new RendererScheduler(new ManualScheduler());

      const binding = renderer.register(() => {});
      binding.markDirty();

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
