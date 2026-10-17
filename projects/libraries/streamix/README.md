# Batch 22 — Higher-order operator integration verification

Verification-only patch against the cumulative Streamix runtime working tree through Batch 21.

Added six regression checks covering real `mergeMap` and `concatMap` pipelines, bounded concurrency, zero-buffer overflow, recovery after a synchronous projection failure, stale inner results after disposal, and idempotent iterator cancellation.

## Validation

- Targeted TypeScript compilation including `atom.ts`, `scope.ts`, `coordinator.ts`, runtime modules, and `switchMap`, `mergeMap`, `concatMap`, `exhaustMap`: **PASS**.
- Standalone Node integration harness: **6/6 PASS**.
- Full Jasmine suite, production builds, React/Vue/Angular adapters: **NOT RUN**.
- This does not establish full operator correctness; especially unverified are `switchMap`/`exhaustMap` push timing, error propagation, backpressure, SSR, and performance.

Run the standalone checks from a complete repository root:

```sh
mkdir -p /tmp/streamix-verify22/build
tsc --target es2022 --module commonjs --moduleResolution node --skipLibCheck --esModuleInterop --outDir /tmp/streamix-verify22/build src/lib/atoms/atom.ts src/lib/atoms/scope.ts src/lib/utils/coordinator.ts src/lib/runtime/*.ts src/lib/operators/{switchMap,mergeMap,concatMap,exhaustMap}.ts
cp verification/operator-integration.cjs /tmp/streamix-verify22/check.cjs
node /tmp/streamix-verify22/check.cjs
```

No production source changes were necessary for the six checks performed.
