# Batch 15 — Runtime event buffering and demand

- Move coordinator event queue and pending-consumer FIFO into `RuntimeEventBuffer`.
- Keep synchronous `__tryNext` and async `next()` compatibility.
- Preserve queued event order and drain buffered events before normal completion.
- Drop detached source events; immediately release pending consumers on cancellation.
- Preserve coordinator batching: only `notify()` flushes pending consumers.
- Add regression tests for FIFO demand, completion, detachment, and cancellation.

**Scope:** Internal buffering migration only. Full operator execution replacement and end-to-end Jasmine tests remain outstanding.

Commit: `refactor(runtime): centralize coordinator event buffering and demand`
