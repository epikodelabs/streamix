# Batch 11 — Concurrent inner admission and scheduler compile repair

Apply over batches 1–10. Only changed files are included.

- Adds `ConcurrentInnerExecution`, which owns mergeMap capacity, queued inputs, and drop-oldest overflow behavior.
- Routes mergeMap source admission and completion through the controller. The existing AsyncCoordinator still owns iterator pulls, cancellation and event ordering; this is NOT a full migration to the event engine.
- Repairs `DefaultScheduler` visibility and missing atom test-harness imports (previous batch compile blockers).
- Adds admission-controller regression tests for concurrency, FIFO draining, overflow, zero buffer, failed projection and invalid limits.

Validation: `tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --skipLibCheck src/lib/operators/mergeMap.ts src/lib/atoms/atom.ts` passed. The Jasmine tests and full project build were not run.
