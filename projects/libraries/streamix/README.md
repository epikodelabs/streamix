# Batch 10 — Sequential inner execution lifecycle

Apply over Batches 1–9.

- Adds a private `SerialInnerExecution` controller for sequential inner iterator ownership, generation invalidation, and idempotent cancellation.
- Migrates `concatMap` and `exhaustMap` to use that controller instead of maintaining their own iterator lifecycle fields.
- Validates `mergeMap` concurrency and buffer limits, and handles zero-sized buffers without accidentally retaining values.
- Adds focused controller lifecycle tests.

## Validation

A standalone TypeScript compile was attempted. It is blocked by existing errors in `src/lib/atoms/atom.ts` (`DefaultScheduler` and `setScheduler` are unresolved). No full integration tests have been run. This is a partial migration, **not** a completed runtime-managed higher-order execution engine. `mergeMap` still uses `createAsyncCoordinator` and `exhaustMap` still depends on the source's `__tryNext` compatibility hook.
