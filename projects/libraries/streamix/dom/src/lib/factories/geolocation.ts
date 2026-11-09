import { fromPush, type Atom } from "@epikodelabs/streamix";

/** Native location updates and recoverable failures, without a placeholder fix. */
export type GeolocationState =
  | { position: GeolocationPosition; error: null }
  | { position: null; error: GeolocationPositionError };

/**
 * Watches geolocation lazily, forwarding native PositionOptions unchanged.
 * All consumers share one watch, cleared when the last consumer leaves.
 * Browser permission is requested only on consumption. Requires a secure
 * context and permission to use geolocation. SSR/unsupported APIs stay silent.
 * Errors are emitted as state, allowing a later successful fix to recover.
 */
export function geolocation(options?: PositionOptions): Atom<GeolocationState> {
  return fromPush<GeolocationState>((sink) => {
    const source = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!source || typeof source.watchPosition !== "function") return () => {};

    let cleaned = false;
    const watch = source.watchPosition(
      position => {
        if (!cleaned) void sink.next({ position, error: null });
      },
      error => {
        if (!cleaned) void sink.next({ position: null, error });
      },
      options,
    );

    return () => {
      if (cleaned) return;
      cleaned = true;
      source.clearWatch(watch);
    };
  }, { name: "geolocation" });
}
