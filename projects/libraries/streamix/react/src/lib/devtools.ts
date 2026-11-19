import {
  createElement,
  useSyncExternalStore,
} from "react";
import {
  recordStreamixDevtoolsEvent,
  streamixDevtoolsEnabled,
  streamixDevtoolsSnapshot,
  subscribeStreamixDevtools,
  type StreamixDevtoolsEvent,
} from "@epikodelabs/streamix";

export { recordStreamixDevtoolsEvent, streamixDevtoolsEnabled };
export type { StreamixDevtoolsEvent };

/**
 * Test-only override for the bundler-provided development flag. Production
 * code never calls this; the test bundle always sees
 * `import.meta.env.DEV === true`, so the production branches would otherwise
 * be unreachable.
 */
let enabled = streamixDevtoolsEnabled;
/** @internal */
export function ɵsetStreamixDevtoolsEnabled(value: boolean): void {
  enabled = value;
}

const noopSubscribe = () => () => {};

/** Returns a live, bounded event trace for custom DevTools integrations. */
export function useStreamixDevtoolsEvents(): readonly StreamixDevtoolsEvent[] {
  return useSyncExternalStore(
    enabled ? subscribeStreamixDevtools : noopSubscribe,
    streamixDevtoolsSnapshot,
    streamixDevtoolsSnapshot,
  );
}

/** A small opt-in in-app DevTools panel for committed renders and reactive flows. */
export function StreamixDevtools(): ReturnType<typeof createElement> | null {
  const trace = useStreamixDevtoolsEvents();
  // Production bundles render nothing; the hook above also skips its
  // subscription while recording is disabled.
  if (!enabled) return null;
  return createElement(
    "aside",
    { "data-streamix-devtools": true, style: { fontFamily: "monospace", fontSize: 12, maxHeight: 240, overflow: "auto", padding: 8, background: "#111", color: "#eee" } },
    createElement("strong", null, "Streamix trace (writes → committed renders)"),
    ...trace.slice(-50).reverse().map((event, index) =>
      createElement("div", { key: `${event.time}-${index}` }, `${event.type}: ${event.source}`),
    ),
  );
}
