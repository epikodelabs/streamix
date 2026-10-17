# Streamix runtime — Batch 3: scheduler and transactions

Apply over Phase 1 + Batch 2. This patch moves the existing depth-ordered scheduler, queue and transaction coordination out of `atoms/atom.ts` into `runtime/scheduling.ts` and attaches it to the internal runtime as `internalRuntime.scheduling`. The existing public `transaction`, `getScheduler`, and `setScheduler` exports remain source-compatible. Atom implementations now obtain their scheduler through the runtime scheduling module; no public runtime argument is added.

## Behavior preserved
- Nested synchronous transactions join one outer commit.
- Writes remain synchronously readable; delivery waits until commit.
- Finalizers run before flush, including on exceptional exit.
- Queued work is ordered by depth and insertion sequence.
- Reentrant scheduling and injected test schedulers remain supported.

## Scope / next
This is **scheduler ownership consolidation**, not yet graph-driven propagation. Existing node dirty/flush paths remain intact; next batch will replace them with runtime-driven dependency invalidation and event dispatch, with diamond and conditional-dependency regressions.

## Validation
Run the project's TypeScript build and full test suite after applying. The source snapshot here does not contain installed node_modules. No test-suite success is claimed.
