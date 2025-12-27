import { isPromiseLike, type MaybePromise, type Receiver, type Stream } from '../abstractions';
import { createSubject } from '../subjects';

/**
 * Creates a stream that emits events of the specified type from the given EventTarget.
 *
 * This function provides a reactive way to handle DOM events or other events,
 * such as mouse clicks, keyboard presses, or custom events. The stream
 * will emit a new event object each time the event is dispatched.
 *
 * @template {Event} T The type of the event to listen for. Defaults to a generic `Event`.
 * @param {EventTarget | PromiseLike<EventTarget>} target The event target to listen to (e.g., a DOM element, `window`, or `document`).
 * @param {string | PromiseLike<string>} event The name of the event to listen for (e.g., 'click', 'keydown').
 * @returns {Stream<T>} A stream that emits the event objects as they occur.
 */
export function fromEvent(target: MaybePromise<EventTarget>, event: MaybePromise<string>): Stream<Event> {
  const subject = createSubject<Event>(); // Create a subject to emit event values.
  let subscriberCount = 0;
  let listening = false;
  let resolvedTarget: EventTarget | null = null;
  let resolvedEvent: string | null = null;

  const originalSubscribe = subject.subscribe; // Capture original subscribe method.

  const listener = (ev: Event) => {
    if (!subject.completed()) {
      subject.next(ev); // Emit the event directly into the subject's stream
    }
  };

  const start = async () => {
    if (listening) return;
    listening = true;

    if (!isPromiseLike(target) && !isPromiseLike(event)) {
      resolvedTarget = target;
      resolvedEvent = event;
      resolvedTarget.addEventListener(resolvedEvent, listener);
      return;
    }

    const targetValue = isPromiseLike(target) ? await target : target;
    const eventValue = isPromiseLike(event) ? await event : event;

    if (!listening) return;

    resolvedTarget = targetValue;
    resolvedEvent = eventValue;
    resolvedTarget.addEventListener(resolvedEvent, listener);
  };

  const stop = () => {
    if (!listening) return;
    listening = false;

    if (resolvedTarget && resolvedEvent) {
      resolvedTarget.removeEventListener(resolvedEvent, listener);
    }

    resolvedTarget = null;
    resolvedEvent = null;
  };

  subject.subscribe = (callback?: ((value: Event) => void) | Receiver<Event>) => {
    const subscription = originalSubscribe.call(subject, callback);
    if (++subscriberCount === 1) {
      void start();
    }

    const originalOnUnsubscribe = subscription.onUnsubscribe;
    subscription.onUnsubscribe = () => {
      if (--subscriberCount === 0) {
        stop();
      }
      originalOnUnsubscribe?.call(subscription);
    };

    return subscription;
  };

  subject.name = 'fromEvent';
  return subject;
}
