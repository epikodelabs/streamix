import {
  RendererScheduler,
  type RenderScheduler,
} from '../lib';

idescribe('RendererScheduler id reuse', () => {
  it('does not flush stale queued work into a reused slot', () => {
    let callback: (() => void) | undefined;

    const scheduler: RenderScheduler = {
      schedule(next) {
        callback = next;
        return () => {};
      },
    };

    const renderer = new RendererScheduler(scheduler);
    let firstFlushes = 0;
    let secondFlushes = 0;

    const first = renderer.register(() => {
      firstFlushes += 1;
    });

    first.markDirty();
    first.destroy();

    const second = renderer.register(() => {
      secondFlushes += 1;
    });

    expect(second.id).toBe(first.id);

    callback?.();

    expect(firstFlushes).toBe(0);
    expect(secondFlushes).toBe(0);

    second.markDirty();
    renderer.flushNow();

    expect(secondFlushes).toBe(1);
  });
});
import { idescribe } from '../../../src/tests/env.spec';
