# Batch 6 — Internal flow execution accounting

Apply over batches 1–5. Only modified source files are included.

- Adds internal RuntimeExecutions, generation tokens and execution counters.
- Instruments the shared `atomFromIteratorInternal` producer used by `flow()` and iterator-backed atoms.
- Tracks starts, active executions, emitted values, completion, cancellation and failure.
- Late completions cannot close a newer execution generation.
- Does not change the public Streamix API.

Scope limitation: this is execution lifecycle accounting, **not yet** a unified event engine for operators. The existing AsyncIterator coordinator remains. Metrics are internal and cumulative, not a stable public API. Full project build/tests could not be run because the reconstructed project lacks its parent tsconfig and dependencies.
