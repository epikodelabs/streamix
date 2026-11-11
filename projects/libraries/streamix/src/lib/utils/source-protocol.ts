/**
 * Typed internal adapter contract for Streamix sources.
 *
 * Every adapter that feeds the coordinator (or an operator) implements the
 * standard `AsyncIterator` pull — `next()`, `return()`, `throw()` — plus a set
 * of optional, explicitly typed capabilities declared by
 * {@link SourceCapabilities}:
 *
 * - **Asynchronous pull** (mandatory): the standard `next()`. Always available.
 * - **Synchronous poll** (optional): {@link SourceCapabilities.pollSync pollSync}
 *   returns the next event immediately when one exists. The outcome is a
 *   {@link SyncPoll} union, which makes the two states adapters must not
 *   conflate structurally distinct: `unavailable` means *nothing can be
 *   produced right now* — the source may still emit later — while an
 *   `available` result with `done: true` means *the source has completed*.
 *   Polls report source errors by throwing, exactly like `next()` does.
 * - **Readiness notification** (optional): {@link SourceCapabilities.onReady onReady}
 *   registers a wake-up listener invoked when a new event becomes available.
 *   Registering one implies the source is push-driven: after a poll returns
 *   `unavailable`, the listener — not a pending `next()` promise — is what
 *   tells the consumer to poll again. The returned function unregisters.
 * - **Closure and terminal state** (optional):
 *   {@link SourceCapabilities.hasBufferedEvents hasBufferedEvents} reports
 *   events already held locally (values or a pending error awaiting delivery),
 *   and {@link SourceCapabilities.isTerminal isTerminal} reports that the
 *   source has completed or been closed. "Can synchronously produce another
 *   value" and "already holds buffered values" are deliberately different
 *   probes: a lazy synchronous iterable (for example an array-backed adapter)
 *   *can* produce its next item on demand without holding anything buffered,
 *   and a completed source is terminal without holding any values at all.
 *
 * Operators composite these capabilities over their input instead of
 * recognizing individual adapters' private conventions, and the coordinator
 * consumes them through the same contract. Adapters are expected to satisfy
 * the shared contract suite in `source-protocol.spec.ts`.
 *
 * @module source-protocol
 */

/**
 * Outcome of a synchronous poll ({@link SourceCapabilities.pollSync pollSync}).
 *
 * - `available`: an event was produced right now. `result.done === false` is a
 *   value; `result.done === true` is the source's terminal completion.
 * - `unavailable`: nothing can be produced synchronously right now. This is
 *   *not* completion — the source may still emit later, either by resolving a
 *   pending `next()` or by firing its readiness listener.
 */
export type SyncPoll<T> =
  | { readonly status: "available"; readonly result: IteratorResult<T> }
  | { readonly status: "unavailable" };

/**
 * Optional capabilities of the internal source protocol, layered on top of the
 * mandatory `AsyncIterator` pull. Every member is optional: adapters declare
 * exactly what they support, and consumers feature-detect through typed
 * optional calls instead of casting to private conventions.
 */
export interface SourceCapabilities<T> {
  /**
   * Synchronously produce the next event when one is available.
   *
   * Returns `unavailable` when nothing can be produced right now — including
   * lazy sources that would succeed on a later attempt — and `available` with
   * a `done` result when the source has completed. Throws when the source has
   * a pending error. Presence of this method is the synchronous-poll
   * capability; whether a specific call yields a value is the state.
   */
  pollSync?(): SyncPoll<T>;

  /**
   * Whether the source currently holds unconsumed events locally: buffered
   * values or a pending error awaiting delivery.
   *
   * Must not report `true` merely because the source *could* synchronously
   * produce a value later (see {@link SourceCapabilities.pollSync pollSync}),
   * and must not fold the terminal state in — use
   * {@link SourceCapabilities.isTerminal isTerminal} for that.
   */
  hasBufferedEvents?(): boolean;

  /**
   * Whether the source has stopped producing: completed, failed, or closed
   * through `return()`. Buffered values and errors may still drain;
   * {@link SourceCapabilities.hasBufferedEvents
   * hasBufferedEvents} may still be `true` while held events drain.
   */
  isTerminal?(): boolean;

  /**
   * Register a listener invoked when a new event becomes available.
   *
   * Registering declares the source push-driven: consumers may stop polling
   * and wait for the listener instead of holding an outstanding `next()`.
   * The returned function unregisters the listener; after it is called the
   * source must not invoke it again. Registrations are independent, including
   * repeated registrations of the same callback. Registering must not start
   * the producer or consume an event.
   */
  onReady?(listener: () => void): () => void;
}

/**
 * The internal adapter contract: the mandatory async pull plus any declared
 * {@link SourceCapabilities}. This is the type operators and the coordinator
 * program against for their inputs, in place of property-sniffing casts.
 */
export type StreamixSource<T> = AsyncIterator<T> & SourceCapabilities<T>;

/**
 * Views a source as a {@link StreamixSource} for typed access to its optional
 * capabilities. The source may be a plain `AsyncIterator` without any
 * capabilities — consumers must treat every member as optional.
 *
 * @param source - Any async iterator, with or without protocol support.
 * @returns The same source, statically viewed through the protocol contract.
 */
export function asStreamixSource<T>(source: AsyncIterator<T>): StreamixSource<T> {
  return source as StreamixSource<T>;
}

/** Readiness notifications shared by push-driven source adapters. */
export function createSourceReadiness() {
  const listeners = new Set<() => void>();
  return {
    get hasListeners(): boolean { return listeners.size > 0; },
    onReady: (listener: () => void): (() => void) => {
      const registration = () => listener();
      listeners.add(registration);
      return () => { listeners.delete(registration); };
    },
    notify: (): void => {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener(); } catch { /* Observers must not prevent source delivery. */ }
      }
    },
  };
}
