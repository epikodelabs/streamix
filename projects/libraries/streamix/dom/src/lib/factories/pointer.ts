import { createSharedSource, type Atom } from "@epikodelabs/streamix";

/** A pointer snapshot. `x` and `y` are viewport coordinates in CSS pixels. */
export type PointerPosition = {
  x: number;
  y: number;
  pageX: number;
  pageY: number;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  buttons: number;
  pressure: number;
};

/**
 * Observes pointer movement and down/up/cancel events on a target (window by
 * default). No position is invented before the first event. One passive set of
 * listeners is shared by consumers and removed when the last consumer leaves.
 * Pending positions use analog delivery: the latest snapshot wins.
 * Safe to construct and consume without a browser.
 */
export function pointer(target?: EventTarget): Atom<PointerPosition> {
  return createSharedSource<PointerPosition>((push) => {
    const source = target ?? (typeof window !== "undefined" ? window : undefined);
    if (!source) return () => {};

    let cleaned = false;
    const listener = (event: Event) => {
      if (cleaned) return;
      const pointer = event as PointerEvent;
      void push({
        x: pointer.clientX,
        y: pointer.clientY,
        pageX: pointer.pageX,
        pageY: pointer.pageY,
        pointerId: pointer.pointerId,
        pointerType: pointer.pointerType,
        isPrimary: pointer.isPrimary,
        buttons: pointer.buttons,
        pressure: pointer.pressure,
      });
    };
    const events = ["pointermove", "pointerdown", "pointerup", "pointercancel"];
    for (const event of events) source.addEventListener(event, listener, { passive: true });

    return () => {
      if (cleaned) return;
      cleaned = true;
      for (const event of events) source.removeEventListener(event, listener);
    };
  }, { name: "pointer", mode: "analog" });
}
