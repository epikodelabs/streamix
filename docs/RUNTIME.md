# Streamix Runtime

## What the runtime does

The runtime is Streamix's internal coordination layer. It does not define the
public reactive API or make application decisions. Instead, it makes the
existing primitives behave consistently when values change, work is deferred,
iterators are pulled, sources are cancelled, or scopes are disposed.

In practical terms, the runtime answers five questions:

| Concern | Runtime responsibility |
| --- | --- |
| Dependencies | Which derived atoms depend on a changed value? |
| Scheduling | When should invalidated derived work run, and in which order? |
| Executions | Which operator or source execution is active, complete, cancelled, or failed? |
| Delivery | How are async-iterator values buffered and handed to waiting consumers? |
| Lifecycle | How are stale pulls, replaced sources, and cancelled inner iterators prevented from producing values? |

The runtime is process-local and private. Consumers use atoms, flows, operators,
and scopes; they never create `StreamixRuntime` instances themselves.

```text
atom write / source emission
            │
            ▼
      dependency graph ──► invalidates derived atoms
            │                         │
            │                         ▼
            │                    scheduler flush
            │
            └──► execution events ──► source coordinators ──► consumers
                                            │
                                            ▼
                                      cancellation / cleanup
```

## Runtime composition

`internalRuntime` is the shared instance in `src/lib/runtime/runtime.ts`. It
contains four runtime services:

| Service | Purpose |
| --- | --- |
| `graph` | Stores current dependency edges between reactive nodes. |
| `scheduling` | Owns the scheduler and synchronous transaction state. |
| `executions` | Tracks active operator executions and aggregate lifecycle counts. |
| `events` | Publishes internal execution events in FIFO order. |

It also has a root identity used by the atom/scope layer. This root is not a
public global store and does not expose an application-facing lifecycle API.

## Dependency graph

Derived atom evaluation records the atom-like sources it reads. When evaluation
finishes, the runtime replaces that derived node's complete dependency set.

```text
price ────┐
          ├──► total
quantity ─┘
```

The graph keeps both directions of an edge:

- **upstream:** sources read by a derived node;
- **downstream:** derived nodes that must be invalidated when a source changes.

Replacing edges instead of adding to them is important for conditional formulas:

```ts
const label = derived($ => $(enabled) ? $(primary) : $(fallback));
```

When `enabled` changes branches, `primary` is removed and `fallback` is added.
Subsequent writes to the inactive branch do not invalidate `label`.

The graph rejects direct self-dependencies and cycles. When a node is disposed,
the runtime removes its edges and its invalidation callback so that it cannot be
scheduled again.

## Scheduling and transactions

Ordinary `atom.next()` and `atom.set()` writes invalidate their dependents and
flush the default scheduler synchronously before returning. Consecutive writes
are separate transitions, even within the same JavaScript turn. Iterator-backed
atoms also flush after each accepted emission, before requesting the next value.
This settles synchronous reactive work; it does not await async subscribers.

An invalidated node is queued once. The default scheduler processes queued work
by dependency depth, with insertion order breaking ties. A diamond therefore
publishes its settled result after both branches update, without publishing a
partial combination. Explicit `.value` reads can recompute dirty values on demand.

```text
ordinary write -> invalidate -> flush -> return
next write     -> invalidate -> flush -> return

transaction { write A; write B; } -> outer commit -> flush
```

`transaction()` batches notifications across a synchronous callback. Writes
update readable state immediately, but subscribers receive the committed state
when the outermost transaction exits. Nested transactions do not flush early.
Transaction finalizers run before the commit flush. Async callbacks are rejected;
transactions do not roll back writes when the callback throws.
All finalizers and the commit flush are attempted even if one fails. A callback
error takes precedence over cleanup errors; otherwise the first cleanup error
is reported.

The scheduler guards against reentrant flushing. Writes from subscribers during
a flush queue further work in the same drain, which settles before the outer
write or transaction returns. A nested write cannot start a competing flush.
An exception from one queued formula is reported without stranding later nodes.

A microtask flush remains a fallback for queued work without an explicit flush.
It does not batch ordinary writes or iterator emissions together. These timing
guarantees describe the default scheduler; custom schedulers control their own
flush implementation.

## Execution accounting and events

`RuntimeExecutions` gives an operator iterator a generation token at its first
pull. It records starts, emitted values, completion, cancellation, and failures.
The token makes a late result from an old execution harmless once a newer
execution has replaced it.

`trackOperatorExecution()` instruments an existing iterator in place. It does
not change the iterator's pull contract:

- work begins on the first `next()`, not while composing an operator;
- a yielded value increments emission accounting and publishes `next`;
- `done` publishes `complete`;
- `return()` publishes `cancel` immediately, even if iterator cleanup awaits;
- a thrown or rejected pull publishes `error`.

The event dispatcher is an internal diagnostic and coordination channel. Events
are queued FIFO. If a listener publishes another event while handling one, all
listeners see the current event first; the new event is delivered afterward.
Listener errors are isolated so diagnostic code cannot break a producer.

## Source execution: pulls, buffering, and demand

Async iterators require a different kind of coordination from atom
invalidation. `RuntimeSourceExecution` combines three focused helpers while a
source coordinator chooses which source to pull.

| Helper | What it owns |
| --- | --- |
| `RuntimeSourcePulls` | One outstanding `next()` call per source slot. |
| `RuntimeEventBuffer` | FIFO produced values, waiting consumers, and terminal delivery. |
| `RuntimeSourceExecution` | Source-slot epochs, event publication, batching, and closure. |

The pull registry coalesces duplicate requests for a busy slot; it never calls
`next()` concurrently for the same iterator. Each attached slot has a
generation. When a slot is detached, replaced, or the execution closes, results
from its earlier generation are ignored.

The event buffer preserves two orderings:

1. Produced values are consumed FIFO.
2. Consumers already waiting receive buffered values before later callers can
   take them.

On completion, buffered values are drained before waiting consumers receive the
terminal result. On cancellation, closing the buffer resolves waiting consumers
immediately; it does not wait for an upstream `iterator.return()` that may never
settle.

## Replacing and cancelling sources

Source slots carry an epoch in addition to pull ownership. Attaching a new
iterator to an existing slot increments its epoch and removes buffered values
from the previous one. A re-entrant event also carries that epoch, so it is
discarded if the source was removed before delivery.

```text
slot 0: source A ── emits value ──► queued event (epoch 1)
slot 0: source B attached ───────► epoch becomes 2
queued event from A ─────────────► discarded
```

This is the boundary that prevents obsolete async results from reaching a
current coordinator after a source replacement.

Coordinator reads preserve earlier consumer demand even inside `batch()`.
When an earlier waiter consumes the available event, a later `next()` waits
for another event or completion; `__tryNext()` returns `null` while still active.

Once a source's completion event is consumed, the coordinator releases its
iterator, push hook, key mapping, and pull ownership. Completed dynamic slots
can then be reused. Naturally completed initial slots retain their index
reservation so operators can continue identifying their fixed inputs.

## Higher-order operator lifecycles

Higher-order operators use small internal controllers rather than duplicating
cancellation rules.

| Controller | Used for | Guarantees |
| --- | --- | --- |
| `SwitchingInnerExecution` | switch-style operators | Advancing immediately invalidates and best-effort closes the previous inner iterator. |
| `SerialInnerExecution` | sequential inner work | Only one iterator is active; stale `next()` results become `done`. |
| `ConcurrentInnerExecution` | merge-style operators | Enforces concurrency and pending-buffer capacity; it does not own iterator pulls. |

These controllers deliberately stop short of imposing an operator policy. For
example, `switchMap` chooses replacement, while `mergeMap` chooses concurrency
and overflow behaviour. The runtime supplies the safe execution and lifecycle
boundaries that make those policies reliable.

## Relationship to scopes and atoms

Atoms register with the runtime so derived dependencies can be tracked,
invalidated, and cleaned up. A scope is responsible for ownership of the atoms
it creates and for disposing that ownership tree. The runtime does not infer
ownership from a dependency edge: a derived atom can read a shared atom without
owning or disposing it.

That separation is intentional:

```text
dependency:  source ──► derived value
ownership:   scope  ──► atom lifetime
```

Dependencies decide what must be recomputed. Ownership decides what must be
released.

## Boundaries

The runtime coordinates mechanics; public primitives retain their semantics.

| Runtime owns | Public primitive owns |
| --- | --- |
| Dependency edges and invalidation | Atom value and subscription semantics |
| Queueing and transaction flushing | Derived formula meaning |
| Iterator execution identity and accounting | Flow/source definition |
| Buffered delivery and stale-result rejection | Operator transformation and concurrency policy |
| Cancellation plumbing | Scope ownership and application lifecycle |

This separation keeps the runtime small, framework-neutral, and invisible to
normal Streamix usage while still giving atoms, flows, and operators one
consistent execution model.
