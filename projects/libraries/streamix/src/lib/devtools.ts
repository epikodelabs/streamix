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
}

type Listener = () => void;

const maxEvents = 250;
let events: readonly StreamixDevtoolsEvent[] = [];
const listeners = new Set<Listener>();
let queued = false;

/** True only when the bundler marks the build as development. */
export const streamixDevtoolsEnabled =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

/** Records one reactive event into the bounded trace. No-op in production. */
export function recordStreamixDevtoolsEvent(event: Omit<StreamixDevtoolsEvent, "time">): void {
  if (!streamixDevtoolsEnabled) return;

  events = [...events, { ...event, time: Date.now() }].slice(-maxEvents);
  if (!queued) {
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const listener of listeners) listener();
    });
  }
}

/** Subscribes to trace changes; the returned function unsubscribes. */
export function subscribeStreamixDevtools(listener: Listener): () => void {
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
