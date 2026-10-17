# Batch 8 — Operator execution instrumentation

Apply over batches 1–7.

- Instruments operator iterators centrally in `createOperator` (also covers `createPushOperator`).
- Starts execution on first `next()` rather than composition.
- Publishes output `next`, `complete`, `cancel`, `error` through the internal event dispatcher, and updates execution metrics.
- Preserves synchronous iterator results, promise-based results, and existing iterator-specific push hooks by wrapping methods in place.
- Terminal events are emitted at most once; no public API changes.

**Scope:** This is the first operator-runtime integration increment. Higher-order operators still use their existing AsyncIterator coordination and do not yet use the runtime as their execution engine. This patch does not claim backpressure, cancellation, or event-graph unification.

**Validation:** Full tests and project typecheck have not been run. This patch needs integration testing, especially `switchMap`, `mergeMap`, `concatMap`, `exhaustMap`, sync fast paths, and cancellation races.
