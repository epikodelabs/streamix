# Streamix Diagnostics Guide

> Normative rules for everything that observes the runtime: execution
> accounting, the runtime event bus, runtime introspection, the inspector
> panel, and devtools tracing. The architectural overview lives in
> [RUNTIME.md](./RUNTIME.md); this document states the rules that any change
> to diagnostics must keep.

## How the layer is shaped

One bus, one ledger, one control surface:

- **One bus** (`runtime/events.ts`): every event the runtime moves — graph
  lifecycle (`register`/`dependencies`/`change`/`flow`/`dispose`), execution
  lifecycle (`next`/`complete`/`cancel`/`error`), and devtools traces — flows
  through a single `RuntimeEventBus` with one sequence and one `observed`
  guard. Diagnostics is a subscriber, never a second channel. Coordinator
  source transport is deliberately *not* on this bus: each execution delivers
  values straight into its own buffer — no bus, no per-event allocation — so
  production source delivery never marks the shared bus observed (rule 1).
  Flow emissions publish one `next`
  event, not a `change` plus a `next`; `changed()` skips the graph event for
  flow-backed nodes in every configuration, not just while instrumentation
  is enabled.
- **One ledger** (`runtime/diagnostics.ts`): `RuntimeDiagnostics` owns all
  diagnostics-only state — execution records, origins, atom/flow state
  readers — plus the frozen `inspect()` snapshot. The reactive core
  (`StreamixRuntime`) never reads it. Record-backed nodes (flows, operator
  iterators) are counted once, in their record — emissions, completions,
  cancels, errors. The browser ledger counts only record-less nodes (atoms,
  deriveds) and mirrors aggregates onto operator definition entries; every
  node is counted by exactly one of the two.
- **One span per execution** (`beginExecution` on the runtime): accounting
  token and bus events in one object, or a shared no-op when instrumentation
  is off and the bus is unobserved. Emission call sites never hand-build
  events; `runtime/operator-execution.ts` and the flow run loop both go
  through it.
- **One control surface** (`runtime/controls.ts`): `streamixDiagnostics`
  with `setEnabled`/`enabled` and the fine-grained `setAccounting` /
  `setOriginCapture`. Internal per rule 7 — never in the package API.
  `enableStreamixIntrospection` arms accounting too: the dev introspection
  flag is the single activation switch, and discovery depends on it — flows
  register into `flowStates` (the discovery source) only while accounting is
  on, so an inspector without accounting sees no flows at all.

## The rules at a glance

| # | Rule | Enforced by |
| --- | --- | --- |
| 1 | No cost when unused | instrumentation flags, `observed` guards, `bench-runtime.mjs` |
| 2 | Observing never interferes | cached reads, getter-free previews, observer isolation |
| 3 | Accounting never lies | generation tokens, displaced-token auto-finish, specs |
| 4 | Printed data never changes | frozen snapshots, bounded previews |
| 5 | Retention is always bounded | trace cap, WeakRef sweeps, record lifetimes |
| 6 | Every node describes itself | origin capture, operator labels, compile-time enrichment |
| 7 | Diagnostics never change semantics | production-parity e2e, toggle specs |
| 8 | Every behavior has a regression spec | `runtime-*.spec.ts`, `introspection.spec.ts` |

---

## 1. No cost when unused

Diagnostics is the first thing production strips and the last thing that may
spend a cycle anyway.

- Event objects are never constructed before the bus's `observed`
  check — not inside `publish()`, and not at the call site. A flow emission in
  an unobserved production build allocates nothing for diagnostics; the
  `beginExecution` span returns the shared no-op.
- Operator iterators are instrumented only when instrumentation is on or a
  listener is attached; otherwise `trackOperatorExecution` returns the
  original iterator untouched.
- Per-node state readers (atom state, flow state) are registered only while
  instrumentation is enabled. No closure per atom in production.
- The disabled path must stay within measurement noise of a build without
  diagnostics at all. `scripts/bench-runtime.mjs` compares disabled /
  accounting / observed medians; a regression in the disabled column blocks
  release.

**New diagnostic hooks follow the same shape:** check the flag or `observed`
*before* building any data. Never construct "just in case".

## 2. Observing never interferes

Inspection is read-only over live objects, and it must not change their
behavior:

- Reading a value through diagnostics serves the cached state. It never
  evaluates a derived formula, never starts an idle flow, never subscribes,
  never marks anything dirty.
- Previews are getter-free: `streamixPreview` reads own property *value*
  descriptors only, prints `[getter]` instead of invoking accessors, and is
  bounded (240 characters, 12 keys, depth 2, circular-safe). Inspecting an
  object must not execute user code.
- Every dispatch and observer boundary isolates failures: a throwing listener,
  observer, or preview can never break propagation or strand a producer.

## 3. Accounting never lies

`RuntimeExecutions` numbers must always reconcile:

- Exactly one terminal exit per execution — `started == completed +
  cancelled + failed`. A displaced token (a second `start()` for the same
  node) is auto-finished as `cancel`, including when instrumentation was
  toggled mid-flight.
- Generation tokens make late results from a previous execution harmless:
  stale `next()` and stale `finish()` are ignored, never counted.
- `error` is the current run's error and is cleared on restart;
  `lastError`/`lastExit` are historical. Consumers pick deliberately.
- Records live exactly as long as their node: released on dispose, and for
  one-shot operator iterators on finish. Accounting memory is bounded by the
  live graph, not by history.

## 4. Printed data never changes

Everything a diagnostic surface has shown is a snapshot, frozen at creation.

- Trace events are `Object.freeze`d when appended. A line already shown to a
  developer is never rewritten, re-counted, or retroactively re-labeled — the
  trace grows, old lines fall off the bounded end, and nothing else.
- `inspect()` and `details()` return frozen snapshots. Live state (current
  value, state, emitted counters) belongs to the object listings, which are
  understood to change; the trace is understood not to.
- When an object dies, its listing row disappears and its terminal event
  stays in the trace. Disposal is recorded, never edited.

## 5. Retention is always bounded

Diagnostics must not become the leak it exists to find.

- Trace: the last 1000 events, oldest discarded. The inspector panel mirrors
  this bound with its DOM rows, so the two never drift apart.
- Inspector entries: `WeakRef` plus a `FinalizationRegistry`, with an
  incremental sweep (16 entries per appended event) so dead metadata releases
  even where finalization is delayed.
- Scheduler heap: stale entries are skipped by identity and dropped at drain.
- There is no unbounded map keyed by something the user creates in a loop.

## 6. Every node describes itself

Self-description is the base layer; build-tooling metadata is enrichment.
The mechanical wiring — which hooks an operator or factory must call, and
which are already handled by the factories — is in
[INTROSPECTION.md](./INTROSPECTION.md).

- In dev builds, every atom, derived, flow, and operator captures its creation
  site (`origin`: file, line, column, function) automatically at the factory
  choke points. No naming, no build step. Operators additionally carry their
  operator name as a label.
- Origin capture is best-effort and honest about it: exact file positions in
  per-module dev serving; bundle-relative positions in bundled builds.
  Capture is disabled in production and can be toggled
  (`streamixDiagnostics.setOriginCapture`).
- The compile-time transform (variable names, owner classes, scope fields)
  refines and overrides — it is never the sole source of metadata. An app
  built without it still gets file-and-line-grade introspection.
- Identity is not name: instances created at the same location get distinct
  ids, and ids stay stable for the object's lifetime.

## 7. Diagnostics never change semantics

Turning diagnostics on or off may change cost, never behavior.

- Same ordering, same values, same cancellation, same errors with the flags
  in either position. The scheduler's ordering invariants are identical under
  instrumentation.
- Production parity is verified, not assumed: a production bundle exposes no
  `window.__streamix`, mounts no inspector panel, and keeps no event history.
- The runtime remains internal. The only public diagnostic surfaces are the
  dev-only browser API and panel; anything else stays behind internal imports.

## 8. Every behavior has a regression spec

A rule in this guide is only real if a test breaks when it is violated.

- `runtime-diagnostics.spec.ts` — records, inspection shape, self-description.
- `runtime-improvements.spec.ts`, `runtime-instrumentation.spec.ts` —
  accounting invariants and the no-cost-when-unused toggles.
- `introspection.spec.ts` — pruning, lazy evaluation, scope relations,
  previews, trace behavior.
- `app6` e2e (`projects/apps/app6/e2e/introspection.mjs`) — the end-to-end
  gate, including production parity.
- Tests that toggle flags restore them in `finally`. Fixture flows that must
  stay observable mid-flight stay pending on a release function; a completed
  fixture releases its record with its atom by design.

---

## Adding a new diagnostic

Checklist before merging anything that observes the runtime:

1. Does it cost nothing (no allocation, no call) when disabled? Rule 1.
2. Does it avoid executing user code and avoid changing what it observes? Rule 2.
3. Does it keep the accounting invariants? Rule 3.
4. Does it emit frozen snapshots? Rule 4.
5. Is its retention bounded? Rule 5.
6. Does it self-describe without requiring the compiler transform? Rule 6.
7. Is behavior identical with it off? Rule 7.
8. Which spec fails if it regresses? Rule 8.
