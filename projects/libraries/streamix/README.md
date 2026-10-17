# Streamix Runtime — Batch 4 (incremental graph-driven invalidation)

Apply over Phase 1 + Batch 2 + Batch 3.

- Internal runtime dispatches committed value-change events along its current dependency graph.
- Derived atoms register an internal invalidation callback, replacing per-dependency change-handler subscriptions for registered Streamix nodes.
- Foreign DependencySource objects retain existing subscription-based observation.
- Conditional dependency replacement immediately affects subsequent event routing.
- Disposal unregisters the invalidator; no public API changes.

**Scope:** This is an incremental migration, not a completed glitch-free scheduler or flow event engine. In particular, the existing eager derived recomputation and scheduler remain; diamond propagation, nested transaction ordering and flow lifecycle need integration testing before claiming graph-driven consistency.

**Validation:** Full project test suite not executed (repository snapshot has no installed dependencies).
