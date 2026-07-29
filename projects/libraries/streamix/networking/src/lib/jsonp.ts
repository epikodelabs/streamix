import { flow, type Atom } from '@epikodelabs/streamix';

/**
 * Creates a stream that performs a JSONP request and emits the resulting data once.
 *
 * This function provides a reactive way to handle JSONP requests, which are
 * often used to bypass the same-origin policy for loading data from a different
 * domain. It dynamically creates a `<script>` tag, handles the response via a
 * global callback, and then cleans up after itself. The stream emits a single
 * value and then completes.
 *
 * @template T The type of the JSONP data to be emitted.
 * @param {string} url The URL to make the JSONP request to.
 * @param {string} [callbackParam='callback'] The name of the query parameter for the callback function.
 * @returns {Atom<T>} A new atom that emits the JSONP data and then completes.
 */
export function jsonp<T = any>(url: string, callbackParam: string = 'callback'): Atom<T> {
  return flow<T>(async function* (signal) {
    if (
      typeof document === "undefined" ||
      typeof window === "undefined" ||
      !document.head
    ) {
      throw new Error("JSONP requires a browser environment");
    }

    const uniqueCallbackName = `${callbackParam}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');

    const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${callbackParam}=${encodeURIComponent(uniqueCallbackName)}`;

    // Promise that resolves when JSONP callback fires or rejects on error
    const data$ = new Promise<T>((resolve, reject) => {
      (window as any)[uniqueCallbackName] = (data: T) => resolve(data);
      script.onerror = () => reject(new Error(`JSONP request failed: ${fullUrl}`));
    });

    script.src = fullUrl;
    document.head.appendChild(script);

    // Helper to cleanup
    const cleanup = () => {
      delete (window as any)[uniqueCallbackName];
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    const abort$ = new Promise<never>((_, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
      } else {
        signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      }
    });

    try {
      // Race the dataPromise against abort signal
      yield await Promise.race([data$, abort$]);
    } finally {
      cleanup();
    }
  });
}


