import {
  RendererScheduler,
  type CancelRender,
  type RenderScheduler,
} from '../lib/render-scheduler';

class ManualFrameScheduler implements RenderScheduler {
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

idescribe('RendererScheduler', () => {
  it('uses one scheduled frame for many dirty bindings', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const calls: number[] = [];

    const a = scheduler.register(() => calls.push(1));
    const b = scheduler.register(() => calls.push(2));

    a.markDirty();
    a.markDirty();
    b.markDirty();

    expect(scheduler.pendingCount).toBe(2);

    frame.flush();

    expect(calls).toEqual([1, 2]);
  });

  it('reuses binding ids after destruction', () => {
    const scheduler = new RendererScheduler(new ManualFrameScheduler());

    const first = scheduler.register(() => {});
    const id = first.id;
    first.destroy();

    const second = scheduler.register(() => {});

    expect(second.id).toBe(id);
  });

  it('isolates a throwing callback and still flushes other bindings', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    spyOn(console, 'error');

    const calls: string[] = [];
    const a = scheduler.register(() => {
      calls.push('a');
      throw new Error('boom');
    });
    const b = scheduler.register(() => calls.push('b'));

    a.markDirty();
    b.markDirty();

    expect(() => frame.flush()).not.toThrow();

    expect(calls).toEqual(['a', 'b']);
    expect(console.error).toHaveBeenCalledTimes(1);

    // The failed binding is deliberately not retried on the next frame.
    expect(frame.callback).toBeUndefined();
  });
});
import { idescribe } from '../../../src/tests/env.spec';
