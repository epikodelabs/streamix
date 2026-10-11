import {
  defineComponent,
  getCurrentScope,
  h,
  onScopeDispose,
  shallowRef,
  type Ref,
} from 'vue';

export interface StreamixDevtoolsEvent {
  readonly type: 'read' | 'subscription' | 'write' | 'unsubscribe' | 'render';
  readonly source: string;
  readonly time: number;
}

type Listener = () => void;
let events: readonly StreamixDevtoolsEvent[] = [];
const listeners = new Set<Listener>();
const maxEvents = 250;
// Keep this as a direct expression so standard production bundlers can fold
// it away. Indirection through globalThis prevents that replacement.
const enabled = typeof process === 'undefined' || process.env['NODE_ENV'] !== 'production';
let queued = false;

/** Queues DevTools notifications outside Vue's render and tracking phases. */
export function recordStreamixDevtoolsEvent(
  event: Omit<StreamixDevtoolsEvent, 'time'>,
): void {
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
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): readonly StreamixDevtoolsEvent[] {
  return events;
}

/** Returns a live, bounded event trace for custom DevTools integrations. */
export function useStreamixDevtoolsEvents(): Readonly<
  Ref<readonly StreamixDevtoolsEvent[]>
> {
  const trace = shallowRef(events) as Ref<readonly StreamixDevtoolsEvent[]>;

  const unsubscribe = subscribe(() => {
    trace.value = events;
  });

  if (getCurrentScope()) {
    onScopeDispose(unsubscribe);
  }

  return trace;
}

/** A small opt-in in-app DevTools panel for committed renders and reactive flows. */
export const StreamixDevtools = defineComponent({
  name: 'StreamixDevtools',
  setup() {
    const trace = shallowRef(snapshot());
    const unsubscribe = subscribe(() => {
      trace.value = snapshot();
    });

    onScopeDispose(unsubscribe);

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

const globalScope = globalThis as typeof globalThis & {
  __streamixDevtoolsRecord?: (event: Omit<StreamixDevtoolsEvent, 'time'>) => void;
};

if (enabled) globalScope.__streamixDevtoolsRecord = recordStreamixDevtoolsEvent;
