import { createAsyncGenerator, Receiver, Stream } from '../abstractions';
import { createSubject } from '../subjects';

/**
 * Creates a reactive stream that emits the time delta (in milliseconds) between
 * consecutive `requestAnimationFrame` calls.
 *
 * This stream provides a convenient way to track frame updates in animations,
 * game loops, or other time-sensitive operations. Each subscriber receives
 * a stream of `number` values representing the elapsed time since the previous frame.
 *
 * **Behavior:**
 * - When a subscriber subscribes, a new RAF loop starts immediately.
 * - The first emitted value is the delta between the first and second RAF callbacks.
 * - Each subsequent frame emits the delta since the previous frame.
 * - When the subscriber unsubscribes, the RAF loop is canceled to avoid unnecessary CPU usage.
 *
 * @returns {Stream<number>} A stream emitting the time delta between frames.
 */
export function onAnimationFrame(): Stream<number> {
  const subject = createSubject<number>();

  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : ((cb: FrameRequestCallback) =>
          setTimeout(() => cb(performance.now()), 16)) as unknown as typeof requestAnimationFrame;

  const caf =
    typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame
      : ((id: any) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;

  let rafId: number | null = null;
  let subscriberCount = 0;
  let stopped = true;
  let lastTime = performance.now();

  const startLoop = () => {
    if (!stopped) return;
    stopped = false;
    lastTime = performance.now();
    const tick = (now: number) => {
      if (stopped) return;
      const delta = now - lastTime;
      lastTime = now;
      subject.next(delta);
      rafId = raf(tick);
    };
    rafId = raf(tick);
  };

  const stopLoop = () => {
    if (stopped) return;
    stopped = true;
    if (rafId !== null) {
      caf(rafId);
      rafId = null;
    }
  };

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (callback?: ((value: number) => void) | Receiver<number>) => {
    const subscription = originalSubscribe.call(subject, callback);

    subscriberCount++;
    if (subscriberCount === 1) {
      startLoop();
    }

    const originalOnUnsubscribe = subscription.onUnsubscribe;
    subscription.onUnsubscribe = () => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) {
        stopLoop();
      }
      originalOnUnsubscribe?.call(subscription);
    };

    return subscription;
  };

  // Ensure async iteration also starts/stops the shared loop
  subject[Symbol.asyncIterator] = () =>
    createAsyncGenerator((receiver) => subject.subscribe(receiver));

  subject.name = 'onAnimationFrame';
  return subject;
}
