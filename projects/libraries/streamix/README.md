# Batch 24 — Shared Flow Lifecycle and Single Iterator Cleanup

This patch applies on top of Batches 1–23.

## Production correction

`atomFromIteratorInternal.stopIterator()` previously cleared the iterator reference **after** awaiting `return()`. Both `disposeInstance()` and the producer's `finally` block can invoke `stopIterator()` while that await is outstanding, causing duplicate `return()` calls. The iterator reference is now claimed and cleared **before** awaiting cleanup, making cancellation idempotent even when concurrent cleanup paths overlap.

## Verification

Targeted TypeScript compilation: PASS.
Standalone Node integration checks: **6/6 PASS**, covering shared execution, late subscriber replay, legitimate `undefined` emissions, final-subscriber cancellation and runtime metrics, normal completion, and repeated disposal.

New Jasmine tests cover shared producer ownership, late replay, `undefined` availability, and execution accounting. Full Jasmine suite, framework integrations and production builds: **NOT RUN**.

To rerun the standalone harness from the cumulative project root:

```sh
tsc --target es2022 --module commonjs --moduleResolution node --skipLibCheck --esModuleInterop --outDir /tmp/streamix-verify24/build src/lib/atoms/atom.ts src/lib/atoms/scope.ts src/lib/utils/coordinator.ts src/lib/runtime/*.ts src/lib/operators/{switchMap,mergeMap,concatMap,exhaustMap}.ts src/lib/factories/from.ts
cp verification/shared-flow-lifecycle.cjs /tmp/streamix-verify24/check.cjs
node /tmp/streamix-verify24/check.cjs
```

## Commit

fix(runtime): make shared flow iterator cleanup idempotent

- Claim iterator ownership before asynchronous return()
- Prevent duplicate cancellation from disposal and producer finalization
- Verify multiple subscribers share one producer
- Cover late replay, final detachment, and execution accounting
- Add shared-flow lifecycle regression tests
