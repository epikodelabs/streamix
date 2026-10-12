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
  streamixDevtoolsSnapshot,
  subscribeStreamixDevtools,
  type StreamixDevtoolsEvent,
} from '@epikodelabs/streamix';

export { recordStreamixDevtoolsEvent };
export type { StreamixDevtoolsEvent };

/** Returns a live, bounded event trace for custom DevTools integrations. */
export function useStreamixDevtoolsEvents(): Readonly<
  Ref<readonly StreamixDevtoolsEvent[]>
> {
  const trace = shallowRef(streamixDevtoolsSnapshot()) as Ref<readonly StreamixDevtoolsEvent[]>;

  const unsubscribe = subscribeStreamixDevtools(() => {
    trace.value = streamixDevtoolsSnapshot();
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
    const trace = shallowRef(streamixDevtoolsSnapshot());
    const unsubscribe = subscribeStreamixDevtools(() => {
      trace.value = streamixDevtoolsSnapshot();
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
