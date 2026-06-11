import type { AtomBase } from "../atoms/atom";
import {
  createReceiver,
  createSubscription,
  type MaybePromise,
  type Operator,
  type OperatorChain,
  type Receiver,
  type Stream,
  type Subscription
} from "../abstractions";
import { pipeSourceThrough, streamToArray } from "../abstractions/stream";
import { firstValueFrom } from "../converters";
import { AsyncPushable, createAsyncPushable } from "../utils/pushable";

/**
 * Creates a {@link Stream} from a reactive {@link AtomBase}.
 *
 * The returned stream mirrors the atom's value state: it emits the atom's
 * current value to new subscribers when the atom is in a value state, emits
 * subsequent values as the atom changes, propagates atom errors as stream
 * errors, and completes when the atom is disposed.
 *
 * This makes an atom usable as a stream source/sink in operator chains while
 * preserving the atom imperative API (`set`, `setError`, `dispose`).
 *
 * @template T The value type held by the atom.
 * @param atom$ The atom to mirror as a stream.
 * @returns A stream backed by the atom.
 */
export function fromAtom<T>(atom$: AtomBase<T>): Stream<T> {
  const listeners = new Set<AsyncPushable<T>>();
  let terminal: { kind: "error"; error: Error } | { kind: "complete" } | null = null;

  const notifyListeners = (fn: (listener: AsyncPushable<T>) => void) => {
    for (const listener of Array.from(listeners)) {
      fn(listener);
    }
  };

  const onStateChange = (state: { tag: "value"; current: T; previous: T | undefined } | { tag: "error"; current: Error; previous: T | undefined } | { tag: "disposed"; previous: T | undefined }) => {
    switch (state.tag) {
      case "value":
        notifyListeners((listener) => { listener.push(state.current); });
        break;
      case "error":
        if (!/has not emitted yet$/.test(state.current.message)) {
          terminal = { kind: "error", error: state.current };
          notifyListeners((listener) => { listener.error(state.current); });
          listeners.clear();
        }
        break;
      case "disposed":
        terminal = { kind: "complete" };
        notifyListeners((listener) => { listener.complete(); });
        listeners.clear();
        break;
    }
  };

  // Subscribe to the atom once. The atom subscription lives as long as the
  // stream reference; atoms stop emitting after disposal/error, so this does
  // not leak work.
  atom$.onStateChange(onStateChange);

  const addListener = (listener: AsyncPushable<T>) => {
    listeners.add(listener);

    // Replay terminal state to late listeners.
    if (terminal) {
      if (terminal.kind === "error") {
        listener.error(terminal.error);
      } else {
        listener.complete();
      }
      listeners.delete(listener);
      return;
    }

    // Emit the atom's current value to new listeners so that fromAtom(atom(initial))
    // behaves like a behavior subject.
    if (atom$.error === null && atom$.safeValue !== undefined) {
      listener.push(atom$.safeValue);
    }
  };

  const subscribe = (
    cb?: ((value: T) => MaybePromise) | Receiver<T>
  ): Subscription => {
    const receiver = createReceiver(cb);
    const listener = createAsyncPushable<T>();
    let stopped = false;

    const drain = () => {
      if (receiver.completed) return;
      while (true) {
        let result;
        try {
          result = (listener as any).__tryNext();
        } catch (e) {
          receiver.error?.(e);
          listeners.delete(listener);
          return;
        }
        if (!result) break;
        if (result.done) {
          receiver.complete?.();
          listeners.delete(listener);
          return;
        }
        if (stopped) continue;
        const ret = receiver.next(result.value);
        if (ret && typeof (ret as any).then === "function") {
          (ret as Promise<unknown>).then(() => {
            drain();
          }, (err) => {
            receiver.error?.(err);
            drain();
          });
          return;
        }
      }
    };

    (listener as any).__onPush = drain;
    addListener(listener);
    drain();

    const sub = createSubscription(() => {
      stopped = true;
      listeners.delete(listener);
      listener.complete();
    });

    return sub;
  };

  const self: Stream<T> = {
    type: "stream",
    name: "fromAtom",
    pipe: ((...ops: Operator<any, any>[]) =>
      pipeSourceThrough<T, any>(self, ops)) as OperatorChain<T>,
    subscribe,
    query: () => firstValueFrom(self),
    toArray: () => streamToArray(self),
    [Symbol.asyncIterator]: () => {
      const listener = createAsyncPushable<T>();
      addListener(listener);

      const originalReturn = listener.return!.bind(listener);
      const originalThrow = listener.throw!.bind(listener);
      const originalNext = listener.next.bind(listener);
      const originalTryNext = (listener as any).__tryNext.bind(listener);

      (listener as any).return = async (v?: any) => {
        listeners.delete(listener);
        return originalReturn(v);
      };
      (listener as any).throw = async (err?: any) => {
        listeners.delete(listener);
        return originalThrow(err);
      };

      listener.next = originalNext;
      (listener as any).__tryNext = originalTryNext;

      return listener;
    }
  };

  return self;
}
