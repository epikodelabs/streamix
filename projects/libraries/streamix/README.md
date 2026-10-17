# Streamix Runtime — Batch 17: Coordinator ownership cleanup

Apply over Batches 1–16.

- Remove the duplicate coordinator `pulling[]` state. `RuntimeSourcePulls` is now the single authority for outstanding source pulls.
- Use runtime pull ownership to prevent synchronous `__tryNext()` from overtaking an outstanding asynchronous `next()`.
- Make coordinator `return()` idempotent: concurrent calls share one cleanup promise, and owned sources receive `return()` only once.
- Release buffered consumers immediately and clear source references before awaiting source cleanup.
- Add regression tests for pull ordering and concurrent cleanup.

## Verification

Targeted TypeScript check passed:

`tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler src/lib/utils/coordinator.ts`

The full Jasmine suite and production builds have **not** been executed. Runtime-wide verification and remaining coordinator migration are still outstanding.
