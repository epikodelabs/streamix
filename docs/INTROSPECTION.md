# Injecting Introspection into Operators and Factories

> How-to for Streamix contributors: which diagnostics hooks a new operator,
> factory, or pipeline must wire, what each hook provides, and what is
> already handled for you. The rules these hooks must obey are normative in
> [DIAGNOSTICS.md](./DIAGNOSTICS.md); this page is the mechanical manual.

## The layering, in one paragraph

Introspection comes from three layers. **The runtime self-describes**: every
atom passes through one choke point that registers it, links its scheduler
state, and captures its creation site; every operator composed through the
standard factories is tracked automatically. **Operators and factories** only
need extra wiring when they build something the choke points cannot see
(flow internals, composition, custom iterators). **The compiler transform**
(optionally) enriches everything with authored names — variable names, owner
classes, scope fields — and is never required for basic introspection.

If you use `createOperator`, `createPushOperator`, or build atoms on
`createAtomBase`, the wiring in this document is already done. Read the
checklist at the end to confirm; read the sections when you go custom.

The `__streamix*` hooks and `trackOperatorExecution` resolve from the core
seam (`src/lib/runtime/introspection-hooks.ts`): inside the core, import them
from there; the implementations live in the
`@epikodelabs/streamix/introspection` secondary entry, which installs them at
import time. Compiled application code keeps importing the hook names from
the package root — the seam delegates.

---

## Factories

### Any atom-producing factory (atom, derived, source atoms)

There is nothing to wire if you build on `createAtomBase`. Its finalizer does
the whole registration:

```ts
// atoms/atom.ts — finalizeAtomInstance (already applied to every instance)
internalRuntime.register(instance, instance[NODE], captureOrigin());
```

That single call provides, for every atom in every factory:

- **Graph registration** — dependency edges can be tracked and invalidation
  can find the node.
- **Scheduler link** — `schedulableOf(node)` exposes `depth`/`queued` to
  diagnostics (the `[NODE]` scheduler object).
- **Self-description** — `captureOrigin()` records `{ file, line, column, fn }`
  of the user code that called your factory. It is dev-only and returns
  immediately in production; do not cache or post-process it.
- **Disposal bookkeeping** — `dispose()` releases the graph node, the
  diagnostics record, and the scheduler queue entry.

One thing your factory **must** provide in its `createAtomBase` config is
`getCachedValue`, plus the other getters:

```ts
const base = createAtomBase<T>({
  getCachedValue: () => current,     // <- diagnostics-only cached read
  conflate, maxSubscribers, node,
  getDisposed: () => disposed,
  getDirty: () => dirty,
  getError: () => errorValue,
  getValue: () => { /* ... */ },
  getSafeValue: () => current,
  getPrevious: () => previous,
  markDirty: () => { /* ... */ },
  /* subscribe hooks */
});
```

`getCachedValue` feeds the `atomState` reader that the inspector uses to show
a value without evaluating anything. It must never run the factory's logic —
return the cached field, nothing else.

### Flow-backed factories (async-iterable sources)

Flow internals are invisible to the choke point, so a flow-backed factory
adds three pieces to the run loop. The canonical form is
`atomFromIteratorInternal` in `atoms/atom.ts`; copy its shape:

**1. Register the flow state — gated, so production builds allocate no
closure:**

```ts
if (isRuntimeInstrumentationEnabled()) {
  internalRuntime.diagnostics.registerFlow(instance, () => ({
    started, awaitingNext, subscribers: activeSubCount,
    hasValue: current !== NO_INITIAL_VALUE,
    value: current === NO_INITIAL_VALUE ? undefined : current,
  }));
}
```

**2. Open one execution span per run — it accounts and publishes together:**

```ts
const span = internalRuntime.beginExecution(instance, instance.name,
  internalRuntime.diagnostics.originOf(instance));
// per emission:
const requestedAt = span.reports ? performance.now() : undefined;
// ...after the pull settles:
span.next(result.value, requestedAt);
// exactly once, in finally (or at dispose):
span.finish(executionExit, executionExit === "error" ? errorValue : undefined);
```

`beginExecution` returns a shared no-op span when instrumentation is off and
the bus is unobserved, so the guard, the token, and the event shape live in
one place — call sites never hand-build events. When a real span is returned,
late results from a previous run are already harmless: the span retires its
token on `finish`, and a stale `next`/`finish` is ignored and never counted.
Pass `diagnostics.originOf(instance)`; do not capture a second origin inside
the run loop. Event kinds are `next`, `complete`, `cancel`, `error`; exactly
one terminal event per run, carrying `error` only for `error`.

### Scopes

Scopes materialize fields lazily; each materialized member that is an atom or
nested scope reports itself once, and scope disposal reports once:

```ts
// per materialized field (createScopeInternal):
__streamixScopeMember(newScope, key, current);
// in disposeScope:
__streamixDebugDispose(sc);
```

`__streamixScopeMember` is a no-op unless instrumentation is enabled and the
value is atom-like; it derives the member's kind (atom / derived / flow /
scope) and links ownership to the parent scope entry.

---

## Operators

### Standard operators — zero wiring

`createOperator` and `createPushOperator` already inject everything after
your transform returns its iterator:

```ts
// atoms/operator.ts — createOperator.apply, after transformFn
__streamixOperatorExecution(op, iterator);
return trackOperatorExecution(iterator, name, captureOrigin());
```

`trackOperatorExecution` instruments `next`/`return`/`throw` in place
(preserving `__tryNext`/`__onPush` hooks), accounts the execution under the
operator's `name`, and attaches the origin of the line that applied the
operator. When instrumentation is off and no listener is attached, it returns
the original iterator untouched — your operator cannot tell.

A new operator therefore only needs:

```ts
export function myOperator<T, R = T>(...) {
  return createOperator<T, R>("myOperator", function (source) {
    // ...your iterator logic; cleanup via return()/throw()...
  });
}
```

Use the operator's own `name` argument for the label — it is what diagnostics
display and what specs match on.

### Custom operators built outside the factories

If you hand-roll an operator object with its own `apply`, wire the two calls
yourself, in this order, at the end of `apply`:

```ts
__streamixOperatorExecution(operatorObject, iterator);  // definition/composition link
return trackOperatorExecution(iterator, "myOperator", captureOrigin());
```

Order matters: the definition link must exist before tracking starts, so the
first pull already resolves to the operator entry.

### Pipelines

`pipe()` records composition so the inspector can show the chain:

```ts
const result = flow(resultIterable);
__streamixPipeline(result, [source, ...ops]);
return result;
```

Any custom pipeline builder should do the same: the flow result plus its
inputs, in order. `__streamixPipeline` stores the inputs and links them as
composition children when the result is registered.

---

## Subscriptions (Angular adoption packages)

Bridges that create subscription handles wrap the `subscribe` call:

```ts
__streamixSubscribe(source, metadata)   // transform-injected at call sites
```

It preserves the receiver and signature, registers the handle, links
`handle.target` to the source's entry, and records disposal when either side
is already gone. Library-side teardown paths call
`__streamixDebugDispose(node, 'unsubscribe')` so handles never outlive their
subscription (see `atoms/subscription.ts`).

---

## What the compiler transform adds (and only adds)

The transform rewrites *call sites*, not your source semantics: it wraps
factory calls with `__streamixDebug(value, metadata)` and atom `subscribe`
calls with `__streamixSubscribe(source, metadata)`, inserting a single helper
import per file. The metadata is `StreamixSourceMetadata`:

```ts
{ kind, name, file, line, column,
  enclosing?,   // "AppComponent.ngAfterViewInit"
  ownerClass?,  // "AppComponent"
  field?,       // "viewportSubscription" (for bound members)
  members? }    // scope configs: per-field metadata, recursive
```

Rules the runtime guarantees regardless of the transform: names fall back to
operator labels, the fallback `factory@line:col` form, or the atom's `name`
property; instances from one creation site get distinct ids; library-internal
nodes never acquire invented application locations. Production builds omit
the wrappers entirely (`streamixDevtoolsEnabled` gates the runtime side).

---

## Checklist for a new operator or factory

| Wiring | Where | Required | Provides |
| --- | --- | --- | --- |
| `createAtomBase` config `getCachedValue` | your factory | yes for atoms | value preview without evaluation |
| funnel through `finalizeAtomInstance` | your factory | yes for atoms | registration, origin, scheduler link, disposal |
| `isRuntimeInstrumentationEnabled()` gate around `registerFlow` | flow factories | yes for flows | live flow state without production closure |
| `executions.start/next/finish` with one token per run | flow run loop | yes for flows | truthful accounting, `describe(node)` — use the `beginExecution` span, which does this plus the events |
| `beginExecution` span instead of hand-built events | run loop + terminals | always | allocation-free emissions when unobserved |
| `createOperator` / `createPushOperator` | operator | preferred | labels, origin, tracking, composition for free |
| `__streamixOperatorExecution` + `trackOperatorExecution` | manual `apply` | if not using the factories | same as above, manual |
| `__streamixPipeline(result, inputs)` | pipeline builders | if custom composition | inspector composition view |
| `__streamixScopeMember` / `__streamixDebugDispose` | scopes and teardown | scopes only | ownership tree, live listings |

Final check before merging: with instrumentation off and no listeners, does
your operator or factory allocate anything per emission or per pull? If yes,
an `observed`/flag guard is missing — see rule 1 in
[DIAGNOSTICS.md](./DIAGNOSTICS.md).
