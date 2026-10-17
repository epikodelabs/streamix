# Streamix Runtime — Batch 19: Integration Verification and Graph Registration Fix

Apply after Batch 18.

## Root cause and fix

`derived()` registered its runtime invalidation callback *before* `createAtomBase()` assigned `instance`. As a result, the callback was registered under `undefined`, not the derived atom. The graph contained the correct dependency edges, but atom writes could not invalidate the derived atom. This produced stale derived values even for `derived(() => a.value * 2)`.

Moved `internalRuntime.onInvalidate(instance, invalidate)` to immediately after `instance = baseInstance`. The existing disposal callback still unregisters it.

## Tests

Added `runtime-graph-registration.spec.ts` for direct invalidation, diamond transaction propagation, and conditional branches with `NO_INITIAL_VALUE`.

## Verification actually executed

- `tsc --skipLibCheck --target es2022 --module commonjs --moduleResolution node --outDir <temporary> src/lib/utils/coordinator.ts`: PASS. This compiled the runtime/atom/coordinator dependency tree.
- Six Node integration smoke tests against compiled JavaScript: PASS (direct derived invalidation, diamond transaction, conditional branch switching, unavailable-value recovery, coordinator FIFO, cancellation with pending consumers).
- Jasmine suite: NOT RUN (dependencies/test harness unavailable in this reconstructed workspace).
- Full production and adapter builds: NOT RUN.

## Follow-up

Run the full monorepo Jasmine suite and production/Angular/React/Vue integration builds. Verify reentrant updates, scope disposal, higher-order operators, backpressure, and dynamic graph depth before declaring the runtime complete.
