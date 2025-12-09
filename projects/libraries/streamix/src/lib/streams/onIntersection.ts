import { isPromiseLike, MaybePromise, Receiver, Stream } from '../abstractions';
import { createSubject } from '../subjects';

/**
 * Creates a stream that emits `true` when a given element enters the
 * viewport and `false` when it leaves.
 *
 * This operator is a wrapper around the `IntersectionObserver` API,
 * making it easy to create reactive streams for "lazy loading" or
 * triggering events when an element becomes visible. The stream will
 * emit a value each time the intersection status changes.
 *
 * @param {Element | PromiseLike<Element>} element The DOM element to observe for intersection changes.
 * @param {IntersectionObserverInit | PromiseLike<IntersectionObserverInit>} [options] Optional configuration for the observer, such as root, root margin, and threshold.
 * @returns {Stream<boolean>} A stream that emits `true` if the element is intersecting the viewport, and `false` otherwise.
 */
export function onIntersection(
  element: MaybePromise<Element>,
  options?: MaybePromise<IntersectionObserverInit>
): Stream<boolean> {
  const subject = createSubject<boolean>();
  subject.name = 'onIntersection';

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (callback?: ((value: boolean) => void) | Receiver<boolean>) => {
    const subscription = originalSubscribe.call(subject, callback);
    let resolvedElement: Element | undefined;
    let resolvedOptions: IntersectionObserverInit | undefined;
    let observer: IntersectionObserver | undefined;
    let mutationObserver: MutationObserver | undefined;
    let disposed = false;

    (async () => {
      resolvedElement = isPromiseLike(element) ? await element : element;
      resolvedOptions = isPromiseLike(options) ? await options : options;
      if (disposed) return;

      observer = new IntersectionObserver((entries) => {
        subject.next(entries[0]?.isIntersecting ?? false);
      }, resolvedOptions);

      observer.observe(resolvedElement);

      mutationObserver = new MutationObserver(() => {
        if (resolvedElement && !document.body.contains(resolvedElement)) {
          subscription.unsubscribe();
          subject.complete?.();
        }
      });

      mutationObserver.observe(document.body, { childList: true, subtree: true });
    })();

    const cleanup = () => {
      disposed = true;
      if (observer && resolvedElement) {
        observer.unobserve(resolvedElement);
        observer.disconnect();
      }
      mutationObserver?.disconnect();
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
