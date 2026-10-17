# Batch 23 — Scope ownership and switchMap timing verification

Verification-only patch on top of Batches 1–22. No production files modified.

## Results
- Targeted TypeScript compilation of atoms, scopes, coordinator, runtime, higher-order operators: PASS.
- Standalone Node integration harness: 7/7 PASS.
- Full Jasmine suite, production builds, framework integrations: NOT RUN.

Tests cover scope-owned atom disposal, borrowed atom preservation, independently created child scope lifetime, idempotent disposal, synchronous switchMap, stale async switchMap projection suppression, and a finite exhaustMap smoke test.

Note: a scope passed into another scope as an already-created object is **borrowed**, not newly owned. The tests deliberately preserve that distinction. ExhaustMap timing/races and shared producer cancellation still need deeper verification.

Run from the complete cumulative repository root:

```sh
mkdir -p /tmp/streamix-verify23/build
tsc --target es2022 --module commonjs --moduleResolution node --skipLibCheck --esModuleInterop --outDir /tmp/streamix-verify23/build src/lib/atoms/atom.ts src/lib/atoms/scope.ts src/lib/utils/coordinator.ts src/lib/runtime/*.ts src/lib/operators/{switchMap,mergeMap,concatMap,exhaustMap}.ts src/lib/factories/from.ts
cp verification/scope-flow-integration.cjs /tmp/streamix-verify23/check.cjs
node /tmp/streamix-verify23/check.cjs
```
