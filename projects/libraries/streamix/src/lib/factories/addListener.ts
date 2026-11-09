import type { Atom } from "../atoms/atom";
import { fromPush } from "./fromPush";

/**
 * Creates an atom that emits events of the specified type from the given EventTarget.
 *
 * @template T The type of the event to emit.
 * @param target The event target to listen to.
 * @param event The name of the event to listen for.
 * @param options Optional event listener options.
 * @returns An atom that emits the event objects as they occur.
 */
export function addListener<T extends Event = Event>(
  target: EventTarget,
  event: string,
  options?: AddEventListenerOptions | boolean
): Atom<T> {
  return fromPush<T>((sink) => {
    let cleaned = false;

    const listener = (ev: Event) => {
      if (cleaned) return;
      void sink.next(ev as T);
    };

    target.addEventListener(event, listener, options);

    return () => {
      if (cleaned) return;
      cleaned = true;
      target.removeEventListener(event, listener, options);
    };
  }, { name: "fromEvent" });
}
