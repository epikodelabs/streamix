# Batch 12 — Coordinator correctness before operator migration

This patch hardens the shared AsyncIterator coordinator used by higher-order operators. It does **not** claim to replace operator coordination with the runtime event engine.

- Multiple concurrent `next()` calls now have FIFO waiter resolution instead of overwriting a single resolver.
- Completion and `return()` settle all outstanding waiters.
- `return()` wakes consumers before awaiting iterator cleanup.
- Synchronous exceptions from source `next()` are converted into normal error events.
- Source `next()` may return a synchronous result through `Promise.resolve` normalization.

Includes focused regression specs. Full project test suite has not been run.

Commit: `fix(runtime): preserve concurrent coordinator waiters and source errors`
