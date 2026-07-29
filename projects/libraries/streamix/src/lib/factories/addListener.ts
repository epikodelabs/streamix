import type { Atom } from "../atoms/atom";
import { createSharedSource } from "../utils/sharedSource";

/**
 * Creates an atom that emits events of the specified type from the given EventTarget.
 *
 * @template T The type of the event to emit.
 * @param target The event target to listen to (or a promise that resolves to one).
 * @param event The name of the event to listen for (or a promise that resolves to one).
 * @param options Optional event listener options.
 * @returns An atom that emits the event objects as they occur.
 */
export function addListener<T extends Event = Event>(
  target: EventTarget,
  event: string,
  options?: AddEventListenerOptions | boolean
): Atom<T> {
  return createSharedSource<T>((push) => {
    let cleaned = false;
    let listener: ((ev: Event) => void) | null = null;
    let resolvedTarget: EventTarget | null = null;
    let resolvedEvent: string | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      if (listener && resolvedTarget && resolvedEvent) {
        resolvedTarget.removeEventListener(resolvedEvent, listener, options);
      }

      listener = null;
      resolvedTarget = null;
      resolvedEvent = null;
    };

    resolvedTarget = target;
    resolvedEvent = event;

    listener = async (ev: Event) => {
      if (cleaned) return;
      await push(ev as T);
    };

    resolvedTarget.addEventListener(resolvedEvent, listener, options);

    return cleanup;
  }, { name: "fromEvent" });
}
