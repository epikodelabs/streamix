import {
  RendererScheduler,
  type CancelRender,
  type RenderScheduler,
} from '../lib/render-scheduler';

class ManualFrameScheduler implements RenderScheduler {
  private callback?: () => void;

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
});
import { idescribe } from '../../../src/tests/env.spec';
