import {
  defineComponent,
  getCurrentScope,
  h,
  onScopeDispose,
  shallowRef,
  type Ref,
} from 'vue';
import {
  recordStreamixDevtoolsEvent,
  streamixDevtoolsEnabled,
  streamixDevtoolsSnapshot,
  subscribeStreamixDevtools,
  type StreamixDevtoolsEvent,
} from '@epikodelabs/streamix';
import { isSSRContext, registerVueDisposal } from './ssr-disposal';

export { recordStreamixDevtoolsEvent, streamixDevtoolsEnabled };
export type { StreamixDevtoolsEvent };

/**
 * Test-only override for the bundler-provided development flag. Production
 * code never calls this; the compiler-fixed test bundle always sees
 * `import.meta.env.DEV === true`, so the production branches would otherwise
 * be unreachable in tests.
 */
let enabled = streamixDevtoolsEnabled;
/** @internal */
export function ɵsetStreamixDevtoolsEnabled(value: boolean): void {
  enabled = value;
}

/** Bounded value preview for trace lines: what changed, not just where. */
function traceValue(value: unknown): string {
  try {
    return (typeof value === 'string' ? value : JSON.stringify(value))?.slice(0, 240) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Records a write preview only when DevTools recording is enabled.
 *
 * The caller passes a reader so the value is not read or serialized in
 * production. The optional flag exists so the disabled path is testable in
 * the development test bundle.
 *
 * @internal
 */
export function ɵrecordStreamixDevtoolsWrite(
  source: string,
  readValue: () => unknown,
  recording = enabled,
): void {
  if (!recording) return;

  let value: unknown;
  try {
    value = readValue();
  } catch {
    value = undefined;
  }
  recordStreamixDevtoolsEvent({ type: 'write', source, value: traceValue(value) });
}

/** Manually owned DevTools trace bridge for code outside a Vue effect scope. */
export interface StreamixDevtoolsEventsBridge {
  readonly events: Readonly<Ref<readonly StreamixDevtoolsEvent[]>>;
  /** Stops listening for trace updates. Safe to call more than once. */
  dispose(): void;
}

/**
 * Creates a manual DevTools trace subscription for code outside `setup()` or
 * an active effect scope. Call {@link StreamixDevtoolsEventsBridge.dispose}
 * when the owner ends.
 */
export function createStreamixDevtoolsEventsBridge(): StreamixDevtoolsEventsBridge {
  const events = shallowRef(
    streamixDevtoolsSnapshot(),
  ) as Ref<readonly StreamixDevtoolsEvent[]>;

  // A manual bridge has no Vue scope to infer ownership from: it subscribes
  // whenever recording is enabled, and the caller disposes it explicitly.
  const unsubscribe = enabled
    ? subscribeStreamixDevtools(() => {
      events.value = streamixDevtoolsSnapshot();
    })
    : () => {};

  let disposed = false;
  return {
    events,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}

/**
 * Returns a live, bounded event trace for custom DevTools integrations.
 *
 * Requires an active Vue effect scope. For manual ownership outside setup,
 * use {@link createStreamixDevtoolsEventsBridge} and dispose it directly.
 */
export function useStreamixDevtoolsEvents(): Readonly<
  Ref<readonly StreamixDevtoolsEvent[]>
> {
  if (!getCurrentScope()) {
    throw new Error(
      'useStreamixDevtoolsEvents() must run inside Vue setup() or an active effectScope(). ' +
      'Use createStreamixDevtoolsEventsBridge() and call dispose() for manually owned usage.',
    );
  }

  const bridge = createStreamixDevtoolsEventsBridge();
  registerVueDisposal(bridge.dispose);

  return bridge.events;
}

/** A small opt-in in-app DevTools panel for committed renders and reactive flows. */
export const StreamixDevtools = defineComponent({
  name: 'StreamixDevtools',
  setup() {
    // The panel is a development tool: production bundles render nothing and
    // allocate no subscription.
    if (!enabled) {
      return () => null;
    }

    // The server never streams trace updates to the client. Render a stable
    // empty panel so hydration matches, but do not add a listener per request.
    const server = isSSRContext();
    const trace = shallowRef(
      server ? [] : streamixDevtoolsSnapshot(),
    ) as Ref<readonly StreamixDevtoolsEvent[]>;

    if (!server) {
      const unsubscribe = subscribeStreamixDevtools(() => {
        trace.value = streamixDevtoolsSnapshot();
      });
      onScopeDispose(unsubscribe);
    }

    return () =>
      h(
        'aside',
        {
          'data-streamix-devtools': true,
          style: {
            fontFamily: 'monospace',
            fontSize: '12px',
            maxHeight: '240px',
            overflow: 'auto',
            padding: '8px',
            background: '#111',
            color: '#eee',
          },
        },
        [
          h('strong', null, 'Streamix trace (writes → committed renders)'),
          ...trace.value.slice(-50).reverse().map((event, index) =>
            h('div', { key: `${event.time}-${index}` }, `${event.type}: ${event.source}`),
          ),
        ],
      );
  },
});
