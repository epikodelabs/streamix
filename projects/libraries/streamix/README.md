# Streamix Runtime — Batch 5: Scheduled graph invalidation

Apply over Phases 1–4.

- Registered derived nodes are **invalidated**, not eagerly recomputed, when a graph dependency changes.
- Existing depth-ordered runtime scheduler processes queued derived evaluations in dependency order.
- Explicit `.value` reads retain synchronous on-demand evaluation.
- Add regression specifications for diamond dependencies, multi-source transactions and conditional edge removal.

## Validation

Full project tests **not run**. The reconstructed Repomix snapshot has no installed dependencies and its TypeScript configuration extends `/tsconfig.json`, which is absent here. These regression tests are added but unverified. This patch does not yet implement an independent flow-event scheduler or prove all reentrant scheduling cases.
