import { Stream, MaybePromise } from '@epikodelabs/streamix';

/**
 * Creates a reactive stream that emits the time delta (in milliseconds) between
 * consecutive animation frames.
 *
 * This stream is driven by `requestAnimationFrame` when available, with a
 * timer-based fallback for non-browser environments.
 *
 * **Behavior:**
 * - A shared RAF loop starts when the first subscriber subscribes.
 * - Emits the delta between consecutive frames.
 * - Stops the RAF loop when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<number>} A stream emitting frame-to-frame time deltas.
 */
declare function onAnimationFrame(): Stream<number>;

/**
 * Represents the current battery status.
 */
type BatteryState = {
    charging: boolean;
    level: number;
    chargingTime: number;
    dischargingTime: number;
};
/**
 * Creates a reactive stream that emits battery state changes.
 *
 * Uses the Battery Status API when available.
 *
 * **Behavior:**
 * - Emits an initial battery snapshot on start.
 * - Emits on charging, level, and time changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<BatteryState>}
 */
declare function onBattery(): Stream<BatteryState>;

/**
 * Creates a reactive stream that emits fullscreen state changes.
 *
 * Emits `true` when entering fullscreen and `false` when exiting.
 *
 * **Behavior:**
 * - Emits the initial fullscreen state on start.
 * - Emits on every fullscreen change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Supports vendor-prefixed implementations.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<boolean>}
 */
declare function onFullscreen(): Stream<boolean>;

/**
 * Creates a reactive stream that emits `IdleDeadline` objects whenever
 * the browser enters an idle period.
 *
 * This stream is useful for scheduling low-priority work such as:
 * - background computations
 * - prefetching
 * - cache warming
 * - non-urgent state updates
 *
 * **Behavior:**
 * - Starts a shared idle loop when the first subscriber subscribes.
 * - Emits the `IdleDeadline` object provided by `requestIdleCallback`.
 * - Continues scheduling idle callbacks until all subscribers unsubscribe.
 * - Falls back to `setTimeout` when `requestIdleCallback` is unavailable.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param timeout Optional timeout (ms) after which idle callback must fire.
 * @returns {Stream<IdleDeadline>} A stream emitting idle deadlines.
 */
declare function onIdle(timeout?: number): Stream<IdleDeadline>;

/**
 * Creates a reactive stream that emits `true` when a given element enters
 * the viewport and `false` when it leaves.
 *
 * This stream is a wrapper around the `IntersectionObserver` API and is useful
 * for lazy loading, visibility tracking, and viewport-aware effects.
 *
 * **Behavior:**
 * - Resolves the element and options once on first subscription.
 * - Emits the current intersection state whenever it changes.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional IntersectionObserver options (or promise).
 * @returns {Stream<boolean>} A stream emitting intersection state.
 */
declare function onIntersection(element: MaybePromise<Element>, options?: MaybePromise<IntersectionObserverInit>): Stream<boolean>;

/**
 * Creates a reactive stream that emits `true` or `false` whenever a CSS media
 * query matches or stops matching.
 *
 * This stream is useful for reacting to viewport size changes, orientation
 * changes, or other media feature conditions.
 *
 * **Behavior:**
 * - Resolves the media query once on first subscription.
 * - Emits the initial match state on start.
 * - Emits on every media query change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param query A CSS media query string (or promise).
 * @returns {Stream<boolean>} A stream emitting match state.
 */
declare function onMediaQuery(query: MaybePromise<string>): Stream<boolean>;

/**
 * Creates a reactive stream that emits arrays of `MutationRecord` objects
 * whenever mutations are observed on a given DOM element.
 *
 * This stream is a wrapper around the `MutationObserver` API and is useful
 * for reacting to DOM structure or attribute changes.
 *
 * **Behavior:**
 * - Resolves the target element and options once on first subscription.
 * - Emits mutation records whenever changes occur.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional MutationObserver options (or promise).
 * @returns {Stream<MutationRecord[]>} A stream of mutation records.
 */
declare function onMutation(element: MaybePromise<Element>, options?: MaybePromise<MutationObserverInit>): Stream<MutationRecord[]>;

/**
 * Represents a snapshot of the current network state.
 */
type NetworkState = {
    online: boolean;
    type?: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
};
/**
 * Creates a reactive stream that emits network connectivity changes.
 *
 * This stream combines:
 * - `online` / `offline` events
 * - Network Information API (when available)
 *
 * **Behavior:**
 * - Emits an initial snapshot on start.
 * - Emits whenever connectivity or connection quality changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Gracefully degrades when Network Information API is unavailable.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<NetworkState>}
 */
declare function onNetwork(): Stream<NetworkState>;

/**
 * Creates a reactive stream that emits the current screen orientation,
 * either `"portrait"` or `"landscape"`, whenever it changes.
 *
 * **Behavior:**
 * - Emits the initial orientation on start.
 * - Emits whenever the orientation changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<"portrait" | "landscape">}
 */
declare function onOrientation(): Stream<"portrait" | "landscape">;

/**
 * Creates a reactive stream that emits the dimensions of a given DOM element
 * whenever it is resized.
 *
 * This stream is a wrapper around the `ResizeObserver` API.
 *
 * **Behavior:**
 * - Resolves the element once on first subscription.
 * - Emits the current width and height whenever the element is resized.
 * - Emits the initial size on start.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @returns {Stream<{ width: number; height: number }>}
 */
declare function onResize(element: MaybePromise<HTMLElement>): Stream<{
    width: number;
    height: number;
}>;

/**
 * Represents a snapshot of the visual viewport.
 */
type ViewportState = {
    width: number;
    height: number;
    scale: number;
    offsetLeft: number;
    offsetTop: number;
};
/**
 * Creates a reactive stream that emits changes to the visual viewport.
 *
 * Uses `visualViewport` when available, falling back to `window`.
 *
 * **Behavior:**
 * - Emits initial viewport metrics on start.
 * - Emits on resize, scroll, and zoom.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<ViewportState>}
 */
declare function onViewportChange(): Stream<ViewportState>;

/**
 * Creates a reactive stream that emits the document's visibility state
 * whenever it changes.
 *
 * This stream is useful for:
 * - pausing animations or polling when the page is hidden
 * - throttling background work
 * - detecting tab switching or minimization
 *
 * **Behavior:**
 * - Emits the current visibility state on start.
 * - Emits on every `visibilitychange` event.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<DocumentVisibilityState>}
 */
declare function onVisibilityChange(): Stream<DocumentVisibilityState>;

export { onAnimationFrame, onBattery, onFullscreen, onIdle, onIntersection, onMediaQuery, onMutation, onNetwork, onOrientation, onResize, onViewportChange, onVisibilityChange };
export type { BatteryState, NetworkState, ViewportState };
