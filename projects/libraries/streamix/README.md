# Batch 7 — Internal flow execution event dispatch

Apply over batches 1–6. Contains changed files only.

- Added an internal, synchronous FIFO event dispatcher that is safe against reentrant publication.
- Flow producers publish `next` and terminal lifecycle events, tagged with execution generation.
- Observers cannot interrupt producers; unsubscribe is supported.
- Added dispatcher ordering and flow integration regression specs.

This is an **incremental instrumentation/event backbone**, not yet a replacement for AsyncIterator coordination in operators. In particular, operators still run through their existing coordinator paths, and full event-engine unification is not complete.

Validation: attempted `tsc -p tsconfig.lib.json --noEmit`; blocked by missing parent `/tsconfig.json` and `@types/node` in the reconstructed repository. Tests were not executed.
