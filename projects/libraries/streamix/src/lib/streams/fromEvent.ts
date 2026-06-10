import { atom } from '@epikodelabs/streamix';
import type { MaybePromise } from '../abstractions';
import { isPromiseLike, pipeSourceThrough, type Stream } from '../abstractions';
import { createAsyncIterator } from '../utils';

/**
 * Creates a stream that emits events of the specified type from the given EventTarget.
 *
 * This function provides a reactive way to handle DOM events or other events,
 * such as mouse clicks, keyboard presses, or custom events. The stream
 * will emit a new event object each time the event is dispatched.
 *
 * The stream handles:
 * - Promise-based resolution of both target and event name
 * - Automatic cleanup when the last subscriber unsubscribes
 * - Multicast to multiple subscribers
 * - Proper error propagation if event listener setup fails
 *
 * @template T The type of the event to listen for.
 * @param target The event target to listen to (e.g., a DOM element, `window`, or `document`).
 *               Can be a direct EventTarget or a Promise that resolves to one.
 * @param event The name of the event to listen for (e.g., 'click', 'keydown').
 *              Can be a direct string or a Promise that resolves to one.
 * @param options Optional event listener options (e.g., `{ once: false, passive: true }`).
 * @returns A stream that emits the event objects as they occur.
 *
 * @example
 * // Basic usage
 * const clicks = fromEvent(document.getElementById('myButton'), 'click');
 * for await (const ev of clicks) {
 *   console.log(ev);
 * }
 *
 * @example
 * // With async target (e.g., waiting for DOM element)
 * const asyncButton = waitForElement('#myButton');
 * const clicks = fromEvent(asyncButton, 'click');
 *
 * @example
 * // With custom event
 * const customEvents = fromEvent(window, 'my-custom-event');
 */
export function fromEvent<T extends Event = Event>(
  target: MaybePromise<EventTarget>,
  event: MaybePromise<string>,
  options?: AddEventListenerOptions | boolean
): Stream<T> {
  const atom$ = atom<T>();

  let subscriberCount = 0;
  let listening = false;
  let resolvedTarget: EventTarget | null = null;
  let resolvedEvent: string | null = null;

  const listener = (ev: Event) => {
    atom$.set(ev as T);
  };

  const start = async () => {
    if (listening) return;
    listening = true;

    if (!isPromiseLike(target) && !isPromiseLike(event)) {
      resolvedTarget = target;
      resolvedEvent = event;
      resolvedTarget.addEventListener(resolvedEvent, listener, options);
      return;
    }

    const targetValue = isPromiseLike(target) ? await target : target;
    const eventValue = isPromiseLike(event) ? await event : event;

    if (!listening) return;

    resolvedTarget = targetValue;
    resolvedEvent = eventValue;
    resolvedTarget.addEventListener(resolvedEvent, listener, options);
  };

  const stop = () => {
    if (!listening) return;
    listening = false;

    if (resolvedTarget && resolvedEvent) {
      resolvedTarget.removeEventListener(resolvedEvent, listener, options);
    }

    resolvedTarget = null;
    resolvedEvent = null;
  };

  const subscribe = (callback?: ((value: T) => void)) => {
    const sub = atom$.subscribe(callback!);
    if (++subscriberCount === 1) {
      void start();
    }

    const originalTeardown = sub.teardown?.bind(sub);
    sub.teardown = () => {
      if (--subscriberCount === 0) {
        stop();
      }
      originalTeardown?.();
    };

    return sub;
  };

  const stream: Stream<T> = {
    type: 'stream',
    name: 'fromEvent',
    subscribe,
    query: async () => {
      return new Promise<T>((resolve) => {
        const sub = subscribe((value) => {
          sub.unsubscribe();
          resolve(value);
        });
      });
    },
    toArray: async () => {
      const result: T[] = [];
      subscribe((value) => {
        result.push(value);
      });
      return result;
    },
    pipe: (...operators: any[]) => {
      return pipeSourceThrough(stream, operators);
    },
    [Symbol.asyncIterator]: () =>
      createAsyncIterator<T>({ register: (receiver) => subscribe((value) => receiver.next?.(value)) })(),
  };

  return stream;
}
