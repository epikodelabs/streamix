# Batch 14 — Runtime-owned source pulls

Move ownership of outstanding source `next()` operations into an internal runtime component (`RuntimeSourcePulls`). The coordinator retains its existing queue and AsyncIterator compatibility while delegating pull lifetimes and stale-result suppression.

- One outstanding pull per source slot.
- Detach invalidates in-flight results, including when sparse indices are reused.
- Closing a coordinator invalidates all outstanding pulls immediately.
- Preserve synchronous throws, asynchronous rejections, and event publication.

This is a transitional step: the coordinator still owns event buffering and push hooks. Full integration tests have **not** been run.

Commit: `refactor(runtime): centralize source pull ownership and stale-result guards`
