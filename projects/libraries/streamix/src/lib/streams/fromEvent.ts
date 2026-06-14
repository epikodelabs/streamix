import { isPromiseLike, type MaybePromise } from "../abstractions";
import { flow, type AtomBase } from "../atoms/atom";

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
): AtomBase<T | undefined> {
  return flow<T>(async function* () {
    const resolvedTarget = isPromiseLike(target) ? await target : target;
    const resolvedEvent = isPromiseLike(event) ? await event : event;

    const queue: T[] = [];
    let resolveNext: ((value: IteratorResult<T>) => void) | null = null;

    const listener = (ev: Event) => {
      if (resolveNext) {
        resolveNext({ value: ev as T, done: false });
        resolveNext = null;
      } else {
        queue.push(ev as T);
      }
    };

    resolvedTarget.addEventListener(resolvedEvent, listener, options);

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const result = await new Promise<IteratorResult<T>>((resolve) => {
            resolveNext = resolve;
          });
          yield result.value;
        }
      }
    } finally {
      resolvedTarget.removeEventListener(resolvedEvent, listener, options);
    }
  });
}
