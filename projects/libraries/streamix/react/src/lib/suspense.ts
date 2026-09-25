import { useRef } from "react";
import { hasAtomEmitted, type Atom } from "@epikodelabs/streamix";
import { useIterable } from "./useIterable";

export interface SuspenseResource<T> {
  /**
   * Reads the atom's current value.
   *
   * Throws a promise on the first read before the atom has produced a
   * value — suspending the nearest `<Suspense>` boundary — and throws the
   * atom's error if it has failed. Once resolved, reads are synchronous.
   */
  read(): T;
}

/**
 * Adapts a streamix {@link Atom} into a Suspense-compatible resource.
 *
 * This bridges the *first* emission only: `read()` suspends until the atom
 * emits once, then returns synchronously from then on. Reading it does not
 * itself trigger a re-render on later emissions — pair it with
 * {@link useIterable} in the same component to
 * stay reactive once past the initial suspend.
 *
 * @example
 * ```tsx
 * // Created once, e.g. at module scope or in a loader.
 * const resource = suspense(flow(() => fetchProfile(id)));
 *
 * function Profile() {
 *   resource.read(); // suspends until the first value lands
 *   const profile = useIterable(userProfile); // stays live afterwards
 *   return <span>{profile.name}</span>;
 * }
 * ```
 */
export function suspense<T>(source: Atom<T>): SuspenseResource<T> {
  let status: "pending" | "success" | "error" = hasAtomEmitted(source)
    ? "success"
    : "pending";
  let result: T = status === "success" ? source.safeValue : (undefined as T);
  let error: unknown;

  const suspender =
    status === "success"
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          source.onError((err) => {
            if (status !== "pending") return;
            status = "error";
            error = err;
            resolve();
          });

          source.subscribe((value) => {
            if (status === "pending") {
              status = "success";
              resolve();
            }
            result = value;
          });
        });

  return {
    read(): T {
      if (status === "pending") throw suspender;
      if (status === "error") throw error;
      return result;
    },
  };
}

/**
 * Suspends until `source` emits for the first time, then returns its live
 * value and stays reactive to later emissions — folding
 * {@link suspense} and {@link useIterable} into a single hook, so
 * you don't need to wire the two together by hand.
 *
 * ```tsx
 * function Profile({ source }: { source: Atom<Profile> }) {
 *   const profile = useSuspense(source); // suspends, then stays live
 *   return <span>{profile.name}</span>;
 * }
 * ```
 */
export function useSuspense<T>(source: Atom<T>): T {
  const cacheRef = useRef<{ source: Atom<T>; resource: SuspenseResource<T> } | null>(null);

  if (cacheRef.current === null || cacheRef.current.source !== source) {
    cacheRef.current = { source, resource: suspense(source) };
  }

  cacheRef.current.resource.read();
  return useIterable(source);
}
