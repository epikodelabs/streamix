# Batch 13 — Runtime-routed coordinator events

The AsyncIterator coordinator now publishes source value, completion and error events through the existing internal `RuntimeEventDispatcher`, and consumes only events tagged with its private coordinator identity. This is an incremental bridge, **not** a replacement of AsyncIterator pull coordination.

- Preserve FIFO, reentrancy-safe runtime dispatch.
- Isolate events across independent coordinator instances.
- Keep existing public iterator and operator APIs unchanged.
- Detach the coordinator's runtime listener on `return()`; ignore late source resolutions.
- Add focused integration tests for event routing, isolation, and cancellation.

Targeted TypeScript compilation of `src/lib/utils/coordinator.ts` passed. The full test suite was not run.

Commit: `refactor(runtime): route coordinator source events through dispatcher`
