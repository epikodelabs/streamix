import { createElement, useSyncExternalStore } from "react";

export interface StreamixDevtoolsEvent {
  readonly type: "read" | "subscription" | "write" | "unsubscribe" | "render";
  readonly source: string;
  readonly time: number;
}

type Listener = () => void;
let events: readonly StreamixDevtoolsEvent[] = [];
const listeners = new Set<Listener>();
const maxEvents = 250;
// Build tools replace `process.env.NODE_ENV` statically. Reading it through
// `globalThis` defeats that replacement and accidentally enables the panel in
// production browser bundles.
// Runtime-safe for native browser ESM where `process` does not exist.
// Bundlers can still statically replace `process.env.NODE_ENV` in this form.
// In unknown environments diagnostics are disabled, not enabled by default.
const enabled = typeof process !== "undefined" && process.env["NODE_ENV"] !== "production";
let queued = false;
/** Queues DevTools notifications outside React's render and snapshot phases. */
export function recordStreamixDevtoolsEvent(event: Omit<StreamixDevtoolsEvent, "time">): void {
  if (!enabled) return;
  events = [...events, { ...event, time: Date.now() }].slice(-maxEvents);
  if (!queued) {
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const listener of listeners) listener();
    });
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): readonly StreamixDevtoolsEvent[] {
  return events;
}

/** Returns a live, bounded event trace for custom DevTools integrations. */
export function useStreamixDevtoolsEvents(): readonly StreamixDevtoolsEvent[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** A small opt-in in-app DevTools panel for committed renders and reactive flows. */
export function StreamixDevtools(): ReturnType<typeof createElement> {
  const trace = useStreamixDevtoolsEvents();
  return createElement(
    "aside",
    { "data-streamix-devtools": true, style: { fontFamily: "monospace", fontSize: 12, maxHeight: 240, overflow: "auto", padding: 8, background: "#111", color: "#eee" } },
    createElement("strong", null, "Streamix trace (writes → committed renders)"),
    ...trace.slice(-50).reverse().map((event, index) =>
      createElement("div", { key: `${event.time}-${index}` }, `${event.type}: ${event.source}`),
    ),
  );
}

const globalScope = globalThis as typeof globalThis & {
  __streamixDevtoolsRecord?: (event: Omit<StreamixDevtoolsEvent, "time">) => void;
};
if (enabled) globalScope.__streamixDevtoolsRecord = recordStreamixDevtoolsEvent;
