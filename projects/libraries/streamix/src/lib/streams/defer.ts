import { createStream, DROPPED, isPromiseLike, type Stream } from '../abstractions';
import { fromAny } from '../converters';

const RAW = Symbol.for("streamix.rawAsyncIterator");

/**
 * Creates a stream that defers the creation of an inner stream until it is
 * subscribed to.
 *
 * This operator ensures that the `factory` function is called only when
 * a consumer subscribes to the stream, making it a good choice for
 * creating "cold" streams. Each new subscription will trigger a new
 * call to the `factory` and create a fresh stream instance.
 *
 * @template T The type of the values in the inner stream.
 * @param {() => (Stream<T> | Promise<T>)} factory A function that returns the stream or value to be subscribed to.
 * @returns {Stream<T>} A new stream that defers subscription to the inner stream.
 */
export function defer<T = any>(factory: () => Stream<T> | Promise<T>): Stream<T> {
  async function* generator() {
    const produced = factory();
    const innerStream = isPromiseLike(produced) ? await produced : produced;

    try {
      const stream = fromAny<T>(innerStream);
      const iterator = ((stream as any)[RAW]?.() ?? stream[Symbol.asyncIterator]()) as AsyncIterator<T>;
      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          if ((result as any).dropped) {
            yield DROPPED(result.value) as any;
          } else {
            yield result.value;
          }
        }
      } finally {
        if (iterator.return) {
          try {
            await iterator.return(undefined);
          } catch {
            // ignore
          }
        }
      }
    } catch (error) {
      throw error;
    }
  }

  return createStream<T>('defer', generator);
}
