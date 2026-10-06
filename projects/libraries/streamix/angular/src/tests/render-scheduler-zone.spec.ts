import {
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
