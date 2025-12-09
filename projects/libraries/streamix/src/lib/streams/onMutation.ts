import { isPromiseLike, MaybePromise, Receiver, Stream } from '../abstractions';
import { createSubject } from '../subjects';

/**
 * Creates a stream that emits an array of `MutationRecord` objects whenever
 * a change is detected on a given DOM element.
 *
 * Automatically unsubscribes if the element is removed from the DOM.
 *
 * @param element The DOM element (or promise) to observe for mutations.
 * @param options An optional object (or promise) specifying which DOM changes to observe.
 * @returns A Stream emitting arrays of `MutationRecord`s.
 */
export function onMutation(
  element: MaybePromise<Element>,
  options?: MaybePromise<MutationObserverInit>
): Stream<MutationRecord[]> {
  const subject = createSubject<MutationRecord[]>();
  subject.name = 'onMutation';

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (callback?: ((value: MutationRecord[]) => void) | Receiver<MutationRecord[]>) => {
    const subscription = originalSubscribe.call(subject, callback);
    let resolvedElement: Element | undefined;
    let resolvedOptions: MutationObserverInit | undefined;
    let observer: MutationObserver | undefined;
    let removalObserver: MutationObserver | undefined;
    let disposed = false;

    (async () => {
      resolvedElement = isPromiseLike(element) ? await element : element;
      resolvedOptions = isPromiseLike(options) ? await options : options;
      if (disposed) return;

      observer = new MutationObserver((mutations) => {
        subject.next([...mutations]);
      });

      observer.observe(resolvedElement, resolvedOptions);

      // Watch for DOM removal
      removalObserver = new MutationObserver(() => {
        if (resolvedElement && !document.body.contains(resolvedElement)) {
          subject.complete?.();
        }
      });
      removalObserver.observe(document.body, { childList: true, subtree: true });
    })();

    const cleanup = () => {
      disposed = true;
      observer?.disconnect();
      removalObserver?.disconnect();
      subscription.unsubscribe();
    };

    const originalOnUnsubscribe = subscription.onUnsubscribe;
    subscription.onUnsubscribe = () => {
      originalOnUnsubscribe?.call(subscription);
      cleanup();
    };
    return subscription;
  };

  return subject;
}
