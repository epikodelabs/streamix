import { useEffect, useRef } from "react";
import type { Scope } from "@epikodelabs/streamix";
import { cancelDeferredDispose, deferDispose } from "./internal/deferredDispose";

/**
 * Creates a streamix {@link Scope} whose lifetime is tied to the component.
 *
 * `factory` runs once, lazily, on the first render. Every atom, derived
 * value, or nested scope created inside it is disposed automatically when
 * the component unmounts — you never need to write manual teardown for
 * state that lives inside the returned scope.
 *
 * The factory is *not* re-run when the component re-renders; pass stable
 * (or already-memoized) inputs into it, the same way you would with
 * `useState(() => ...)`.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const state = useScope(() => scope({
 *     count: 0,
 *     doubled: (self) => self.count * 2,
 *   }));
 *
 *   const count = useIterable(state.refs.count);
 *   const doubled = useIterable(state.refs.doubled);
 *
 *   return (
 *     <button onClick={() => { state.count = count + 1; }}>
 *       {count} (doubled: {doubled})
 *     </button>
 *   );
 * }
 * ```
 */
export function useScope<T extends Record<string, any>>(factory: () => T): T {
  const ref = useRef<T | null>(null);
  if (ref.current === null) {
    ref.current = factory();
  }

  useEffect(() => {
    const instance = ref.current as unknown as Scope;
    cancelDeferredDispose(instance);
    return () => {
      deferDispose(instance, () => instance.dispose());
    };
  }, []);

  return ref.current;
}
