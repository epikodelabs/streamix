import { raceAbort } from './abort';
import { fromTask } from './task';
import type { Stream } from './stream';

let callbackId = 0;

export function jsonp<T = unknown>(
  url: string,
  callbackParam = 'callback',
): Stream<T> {
  return fromTask<T>(async (signal) => {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !document.head) {
      throw new Error('JSONP requires a browser environment');
    }

    const callbackName = `${callbackParam}_${Date.now().toString(36)}_${callbackId++}`;
    const script = document.createElement('script');
    const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${callbackParam}=${encodeURIComponent(callbackName)}`;
    const globals = window as unknown as Record<string, unknown>;

    const result = new Promise<T>((resolve, reject) => {
      globals[callbackName] = resolve;
      script.onerror = () => reject(new Error(`JSONP request failed: ${fullUrl}`));
    });

    script.src = fullUrl;
    document.head.appendChild(script);

    try {
      return await raceAbort(signal, result);
    } finally {
      delete globals[callbackName];
      script.remove();
    }
  });
}
