/**
 * Framework-agnostic DevTools event trace shared by every adoption package.
 *
 * The store is plain TypeScript: adoption packages instrument their bridges
 * through {@link recordStreamixDevtoolsEvent}, and each framework renders the
 * same bounded trace with its own panel component. Recording is enabled only
 * when the bundler marks the build as development, so production bundles carry
 * no event history and pay no instrumentation cost beyond one boolean check.
 */

export interface StreamixDevtoolsEvent {
  readonly type: "read" | "subscription" | "write" | "unsubscribe" | "render";
  readonly source: string;
  readonly time: number;
  /** Preview of the written value for `write` events, when the reporter has it. */
  readonly value?: string;
}

/** Callback invoked with each recorded event; the trace still changes atomically per microtask. */
export type StreamixDevtoolsListener = (event: StreamixDevtoolsEvent) => void;

const maxEvents = 250;
let events: readonly StreamixDevtoolsEvent[] = [];
const listeners = new Set<StreamixDevtoolsListener>();
let pending: StreamixDevtoolsEvent[] = [];
let queued = false;

/** True only when the bundler marks the build as development. */
export const streamixDevtoolsEnabled =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

/** Records one reactive event into the bounded trace. No-op in production. */
export function recordStreamixDevtoolsEvent(event: Omit<StreamixDevtoolsEvent, "time">): void {
  if (!streamixDevtoolsEnabled) return;

  const recorded: StreamixDevtoolsEvent = { ...event, time: Date.now() };
  events = [...events, recorded].slice(-maxEvents);
  pending.push(recorded);
  if (!queued) {
    queued = true;
    queueMicrotask(() => {
      queued = false;
      // Deliver every event recorded since the last flush; panels usually
      // re-read the snapshot, trace consumers need each event exactly once.
      const batch = pending;
      pending = [];
      for (const event of batch) {
        for (const listener of [...listeners]) {
          try { listener(event); } catch { /* a broken panel must not stop recording */ }
        }
      }
    });
  }
}

/** Subscribes to trace changes; the returned function unsubscribes. */
export function subscribeStreamixDevtools(listener: StreamixDevtoolsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current bounded trace, oldest first. */
export function streamixDevtoolsSnapshot(): readonly StreamixDevtoolsEvent[] {
  return events;
}

const globalScope = globalThis as typeof globalThis & {
  __streamixDevtoolsRecord?: (event: Omit<StreamixDevtoolsEvent, "time">) => void;
};

// Do not replace another framework's recorder in a mixed-framework host.
if (streamixDevtoolsEnabled && !globalScope.__streamixDevtoolsRecord) {
  globalScope.__streamixDevtoolsRecord = recordStreamixDevtoolsEvent;
}
