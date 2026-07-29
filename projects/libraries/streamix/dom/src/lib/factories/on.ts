import type { Atom } from "@epikodelabs/streamix";
import { animationFrame } from "./animationFrame";
import { battery, type BatteryState } from "./battery";
import { fullscreen } from "./fullscreen";
import { idle } from "./idle";
import { intersection } from "./intersection";
import { mediaQuery } from "./mediaQuery";
import { mutation } from "./mutation";
import { network, type NetworkState } from "./network";
import { orientation } from "./orientation";
import { resize } from "./resize";
import { viewportChange, type ViewportState } from "./viewportChange";
import { visibilityChange } from "./visibilityChange";

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
  element: Element,
  options?: IntersectionObserverInit
): Atom<boolean>;
export function on(type: 'mediaQuery', query: string): Atom<boolean>;
export function on(
  type: 'mutation',
  element: Element,
  options?: MutationObserverInit
): Atom<MutationRecord[]>;
export function on(type: 'network'): Atom<NetworkState>;
export function on(type: 'orientation'): Atom<'portrait' | 'landscape'>;
export function on(
  type: 'resize',
  element: HTMLElement
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
      return animationFrame();
    case 'battery':
      return battery();
    case 'fullscreen':
      return fullscreen();
    case 'idle':
      return idle(args[0] as number | undefined);
    case 'intersection':
      return intersection(
        args[0] as Element,
        args[1] as IntersectionObserverInit | undefined
      );
    case 'mediaQuery':
      return mediaQuery(args[0] as string);
    case 'mutation':
      return mutation(
        args[0] as Element,
        args[1] as MutationObserverInit | undefined
      );
    case 'network':
      return network();
    case 'orientation':
      return orientation();
    case 'resize':
      return resize(args[0] as HTMLElement);
    case 'viewportChange':
      return viewportChange();
    case 'visibilityChange':
      return visibilityChange();
    default:
      throw new Error(`[on] Unsupported DOM source type: ${type}`);
  }
}
