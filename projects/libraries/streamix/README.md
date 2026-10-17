# Batch 9 — SwitchMap inner execution generations

Apply on top of batches 1–8.

- Introduce internal `SwitchingInnerExecution` as a reusable cancellation and generation boundary.
- Migrate `switchMap` to invalidate obsolete projections synchronously and cancel superseded iterators.
- Ignore stale promise fulfillment/rejection and stale inner values.
- Preserve push-based `__tryNext` / `__onPush` source handling and existing public API.
- Add a regression test for stale projection rejection.

**Not completed:** `mergeMap`, `concatMap`, and `exhaustMap` still use their existing coordination; no claim of a fully unified operator runtime. Full suite not run: reconstructed workspace lacks `/tsconfig.json` and `@types/node`.
