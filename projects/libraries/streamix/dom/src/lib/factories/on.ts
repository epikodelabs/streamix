import type { Atom, MaybePromise } from "@epikodelabs/streamix";
import { onAnimationFrame } from "./onAnimationFrame";
import { onBattery, type BatteryState } from "./onBattery";
import { onFullscreen } from "./onFullscreen";
import { onIdle } from "./onIdle";
import { onIntersection } from "./onIntersection";
import { onMediaQuery } from "./onMediaQuery";
import { onMutation } from "./onMutation";
import { onNetwork, type NetworkState } from "./onNetwork";
import { onOrientation } from "./onOrientation";
import { onResize } from "./onResize";
import { onViewportChange, type ViewportState } from "./onViewportChange";
import { onVisibilityChange } from "./onVisibilityChange";

export type { BatteryState, NetworkState, ViewportState };

/**
 * Creates a reactive stream for a DOM or browser event source.
 *
 * `on` is a single entry point that dispatches to the appropriate DOM adapter
 * based on the requested source type.
 *
 * @example
 * ```ts
 * const clicks = on('click', document);
 * const battery = on('battery');
 * const matches = on('mediaQuery', '(min-width: 600px)');
 * const resized = on('resize', element);
 * ```
 */
export function on(type: 'animationFrame'): Atom<number>;
export function on(type: 'battery'): Atom<BatteryState>;
export function on(type: 'fullscreen'): Atom<boolean>;
export function on(type: 'idle', timeout?: number): Atom<IdleDeadline>;
export function on(
  type: 'intersection',
  element: MaybePromise<Element>,
  options?: MaybePromise<IntersectionObserverInit>
): Atom<boolean>;
export function on(type: 'mediaQuery', query: MaybePromise<string>): Atom<boolean>;
export function on(
  type: 'mutation',
  element: MaybePromise<Element>,
  options?: MaybePromise<MutationObserverInit>
): Atom<MutationRecord[]>;
export function on(type: 'network'): Atom<NetworkState>;
export function on(type: 'orientation'): Atom<'portrait' | 'landscape'>;
export function on(
  type: 'resize',
  element: MaybePromise<HTMLElement>
): Atom<{ width: number; height: number }>;
export function on(type: 'viewportChange'): Atom<ViewportState>;
export function on(type: 'visibilityChange'): Atom<DocumentVisibilityState>;

/**
 * Creates a reactive stream for a DOM or browser event source.
 *
 * `on` is a single entry point that dispatches to the appropriate DOM adapter
 * based on the requested source type.
 */
export function on(type: string, ...args: any[]): Atom<any> {
  switch (type) {
    case 'animationFrame':
      return onAnimationFrame();
    case 'battery':
      return onBattery();
    case 'fullscreen':
      return onFullscreen();
    case 'idle':
      return onIdle(args[0] as number | undefined);
    case 'intersection':
      return onIntersection(
        args[0] as MaybePromise<Element>,
        args[1] as MaybePromise<IntersectionObserverInit> | undefined
      );
    case 'mediaQuery':
      return onMediaQuery(args[0] as MaybePromise<string>);
    case 'mutation':
      return onMutation(
        args[0] as MaybePromise<Element>,
        args[1] as MaybePromise<MutationObserverInit> | undefined
      );
    case 'network':
      return onNetwork();
    case 'orientation':
      return onOrientation();
    case 'resize':
      return onResize(args[0] as MaybePromise<HTMLElement>);
    case 'viewportChange':
      return onViewportChange();
    case 'visibilityChange':
      return onVisibilityChange();
    default:
      throw new Error(`[on] Unsupported DOM source type: ${type}`);
  }
}
