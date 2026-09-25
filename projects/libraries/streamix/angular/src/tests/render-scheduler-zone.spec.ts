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
    let executionsOutside = 0;

    const scheduler = createOutsideAngularRenderScheduler(
      {
        runOutsideAngular<T>(callback: () => T): T {
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
          return delegate.schedule(() => {
            callback();
            if (depth > 0) executionsOutside += 1;
          });
        },
      },
    );

    const renderer = new RendererScheduler(scheduler);
    let flushes = 0;
    const binding = renderer.register(() => { flushes += 1; });

    binding.markDirty();
    delegate.flush();

    expect(registrationsOutside).toBe(1);
    expect(executionsOutside).toBe(1);
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
});
