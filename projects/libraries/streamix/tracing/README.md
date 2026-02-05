# streamix Tracing

## What it is

Tracing for Streamix captures the life cycle of values flowing through a stream pipeline while keeping the runtime hooks completely transparent for normal execution. Think of it as a non-intrusive observer that records when each value enters an operator, whether it continues down the pipeline, and when it finally reaches a consumer or is dropped for a reason (filter, collapse, error, or simply completion).

## Why you might use it

- Diagnose why a stream is dropping values or producing unexpected outcomes by following per-value timelines rather than relying solely on logs.
- Measure latency inside operators with timing metadata so you can spot slow/blocked operators and tune performance without modifying your core logic.
- Replay or visualize active subscriptions in developer tooling, dashboards, or tests, because each traced value carries identifiers for the stream, operator, and subscription that processed it.

## How to enable it

1. Create either the full `createValueTracer` or lighter `createTerminalTracer`, depending on whether you need per-operator detail.
2. Register it globally with `enableTracing(tracer)` before you start working with streams.
3. Subscribe to the tracer’s lifecycle events (`delivered`, `filtered`, `collapsed`, `dropped`) or query `getAllTraces()` for snapshots of the current data.
4. When you don’t need tracing anymore, call `disableTracing()` to restore the normal run-time with zero extra wrapping.

## Common observability scenarios

- **Tracing dashboards**: collect events from `onTraceUpdate` and feed them into your UI to watch how values progress through a flow.
- **Conditional instrumentation**: toggle tracer registration based on a debug flag so production runs stay lean while development builds have full insight.
- **Testing helpers**: rely on the tracer’s events inside your specs to assert that values were filtered, collapsed, or errored in expected ways.

## Where to dig deeper

The implementation lives alongside the rest of Streamix in `projects/libraries/streamix/tracing`. Refer to the tests (`tracer.spec.ts`) for concrete expectations and lifecycle coverage if you ever need to understand specific hooks.
