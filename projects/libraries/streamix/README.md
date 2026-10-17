# Streamix runtime batch 2 — availability and conditional graph reconciliation

Apply these changed files over the previous `streamix-runtime-phase1` tree.

- Uninitialized writable and iterable-backed atoms hold the existing `NO_INITIAL_VALUE` sentinel instead of `undefined`.
- During synchronous derived evaluation, a read of an unavailable dependency interrupts the formula with an internal control signal. The derived result remains `NO_INITIAL_VALUE` without entering an error state.
- The read is tracked before interruption, allowing the first upstream emission to recover the derived value.
- Derived dependencies are reconciled with the actual current evaluation read set; stale subscriptions are removed on branch switches, including unavailable branches.
- Derived values that are unavailable are not replayed to new subscribers as normal values.
- Regression tests cover undefined-as-a-value, conditional branch switches, and first flow emission.

## Validation

Not run: the provided Repomix reconstruction has no installed dependencies and its `tsconfig.lib.json` extends a missing root `tsconfig.json`. `tsc --noEmit -p tsconfig.lib.json` fails during configuration loading. This is an incremental source patch, not a verified release.

## Remaining architectural work

This batch does not replace the existing scheduler or AsyncIterator operator engine. The next batch should consolidate scheduling/transactions in the internal runtime and add event-vs-value edges without changing the public API.
