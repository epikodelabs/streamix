import { isPromiseLike, type MaybePromise } from "../abstractions";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { asyncAtom, type AtomBase } from "../atoms/atom";

/**
 * Creates an atom that emits events of the specified type from the given EventTarget.
 *
 * @template T The type of the event to listen for.
 * @param target The event target to listen to.
 * @param event The name of the event to listen for.
 * @param options Optional event listener options.
 * @returns An atom that emits the event objects as they occur.
 */
export function fromEvent<T extends Event = Event>(
  target: MaybePromise<EventTarget>,
  event: MaybePromise<string>,
  options?: AddEventListenerOptions | boolean
): AtomBase<T> {
  const output = asyncAtom<T>();
  const originalSubscribe = output.subscribe.bind(output);

  let activeCount = 0;
  let listener: ((ev: Event) => void) | null = null;
  let resolvedTarget: EventTarget | null = null;
  let resolvedEvent: string | null = null;
  let attachPromise: Promise<void> | null = null;
  let aborted = false;

  const ensureAttached = async () => {
    if (listener) return;
    if (attachPromise) return attachPromise;

    attachPromise = (async () => {
      resolvedTarget = isPromiseLike(target) ? await target : target;
      resolvedEvent = isPromiseLike(event) ? await event : event;
      if (aborted) return;

      listener = (ev: Event) => output.next(ev as T);
      resolvedTarget.addEventListener(resolvedEvent, listener, options);
    })();

    return attachPromise;
  };

  const detach = () => {
    if (listener && resolvedTarget && resolvedEvent) {
      resolvedTarget.removeEventListener(resolvedEvent, listener, options);
      listener = null;
    }
  };

  output.subscribe = (callback: (value: T) => void): Subscription => {
    const baseSub = originalSubscribe(callback);

    if (activeCount === 0) {
      void ensureAttached();
    }
    activeCount++;

    return createSubscription(() => {
      baseSub.unsubscribe();
      activeCount--;
      if (activeCount <= 0) {
        aborted = true;
        detach();
      }
    });
  };

  return output;
}
