import { createSharedSource, type Atom } from "@epikodelabs/streamix";

/** Scroll offsets in CSS pixels, preserving fractional and negative values. */
export type ScrollPosition = { x: number; y: number };

/**
 * Observes scrolling on window (the default), a document, or an element.
 * Emits the current offsets on connection, then snapshots on scroll events.
 * Uses a shared passive listener, removed after the last consumer leaves.
 * Pending snapshots use analog delivery; descendants' scrolls are not observed.
 * Safe to construct and consume without a browser.
 */
export function scroll(target?: Window | Document | Element): Atom<ScrollPosition> {
  return createSharedSource<ScrollPosition>((push) => {
    const source = target ?? (typeof window !== "undefined" ? window : undefined);
    if (!source) return () => {};

    const snapshot = (): ScrollPosition => {
      if ("scrollX" in source) return { x: source.scrollX, y: source.scrollY };
      if ("scrollingElement" in source) {
        const element = source.scrollingElement;
        return { x: element?.scrollLeft ?? 0, y: element?.scrollTop ?? 0 };
      }
      return { x: source.scrollLeft, y: source.scrollTop };
    };
    let cleaned = false;
    const emit = () => {
      if (!cleaned) void push(snapshot());
    };
    source.addEventListener("scroll", emit, { passive: true });
    emit();

    return () => {
      if (cleaned) return;
      cleaned = true;
      source.removeEventListener("scroll", emit);
    };
  }, { name: "scroll", mode: "analog" });
}
