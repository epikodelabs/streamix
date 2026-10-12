import {
  createElement,
  useSyncExternalStore,
} from "react";
import {
  recordStreamixDevtoolsEvent,
  streamixDevtoolsSnapshot,
  subscribeStreamixDevtools,
  type StreamixDevtoolsEvent,
} from "@epikodelabs/streamix";

export { recordStreamixDevtoolsEvent };
export type { StreamixDevtoolsEvent };

/** Returns a live, bounded event trace for custom DevTools integrations. */
export function useStreamixDevtoolsEvents(): readonly StreamixDevtoolsEvent[] {
  return useSyncExternalStore(subscribeStreamixDevtools, streamixDevtoolsSnapshot, streamixDevtoolsSnapshot);
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
