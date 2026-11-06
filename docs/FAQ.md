# Streamix FAQ

Answers to the questions that come up when adopting Streamix, each grounded
in the runtime's actual behavior (current main / v3 atom & flow model).

## Contents

1. [Cancellation and teardown: what happens when a consumer stops early, an Angular component is destroyed, or an async iterator is abandoned?](#1-cancellation-and-teardown)
2. [Backpressure: whether producers can outpace consumers, and how buffering or coalescing is selected.](#2-backpressure)
3. [Error and completion: how exceptions, terminal states, and retries map from an RxJS mental model to the iterator model.](#3-error-and-completion)
4. [Hot versus cold behavior, multicasting, and scheduling/time-based operators.](#4-hot-versus-cold-multicasting-and-scheduling)

## 1. Cancellation and teardown

Streamix treats cancellation as a question of **ownership**. A consumer can
detach without shutting down a source that others still use. When the last
owner leaves, production stops for ordinary flows and shared sources; the
atom retains its last state.

| Situation                                 | What happens                                                                         | What you need to do                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Consumer stops early                      | The consumer detaches. For flows / shared sources, production stops if it was the last owner. | Call the unsubscribe function, or exit the `for await` loop.                        |
| Angular component is destroyed            | Compiled bindings are cleaned up automatically through `DestroyRef`.                 | Explicitly clean up subscriptions and iterators created manually in component code. |
| Active async iterator is simply abandoned | No cancellation notification is sent. Subscriptions and resources can remain active. | Close it with `return()`, usually in `finally`.                                     |

### Three operations to keep apart

- **Unsubscribe:** detaches one consumer and clears its queued deliveries.
- **Stop production:** ends the producer (iterator is closed) while the atom
  keeps its last state.
- **Dispose:** explicitly releases the atom’s resources, subscriptions, and
  disposal handlers (`atom.dispose()`).

Unsubscribing can lead to a producer stop for flows and shared sources, but
it does not automatically dispose a plain writable atom.

### When a consumer stops early

A subscription is a cleanup handle you can call:

```ts
const unsubscribe = output.subscribe(value => {
  // Handle value.
});

await unsubscribe();   // or just unsubscribe()
```

The first call marks the subscription inactive immediately and runs teardown.
Later calls are no-ops.

Removing one consumer does not necessarily stop the pipeline. If another
subscriber still owns the output, production continues.

For **flow-backed atoms** and **shared sources**, the last subscriber leaving
stops the producer (the underlying iterator is closed). The atom retains its
last value; a later subscriber receives that retained value but does **not**
restart the producer.

Plain **writable atoms** do not auto-stop or auto-dispose when the last
subscriber leaves; they stay alive until you call `dispose()`.

### How cleanup travels through a pipeline

A `pipe()` call creates one new flow-backed output atom around a chain of
iterator stages:

```ts
const output = pipe(
  source,
  map(transform),
  filter(predicate),
);
```

```text
source atom → source iterator → map iterator → filter iterator → output atom
```

The output atom owns the pipeline’s current value, subscriptions, and
producer lifecycle. When the output stops, it closes the chain from the end
back toward the source (`return()` is forwarded upstream). Operators that own
resources (timers, buffers, inner iterators) must arrange their own cleanup;
`createOperator` supplies upstream `return()` forwarding when an operator’s
iterator does not define it.

Stopping one pipeline does not interrupt another pipeline that shares the
same source. Detaching from a writable atom does not make that atom unusable.

### Work already in progress

Streamix invalidates a stopped producer’s session so late results cannot
produce new emissions from that output atom. A shared upstream source can
still emit for its remaining consumers.

Cancellation cannot forcibly interrupt a JavaScript callback or promise that
has already started. An asynchronous mapper, predicate, or subscriber
callback may still finish and perform side effects.

A flow supplies an `AbortSignal` to its source factory. On cancellation it
aborts the signal. Actually stopping external work requires cooperation: the
operation must observe the signal, or the source must release its resources
during cleanup.

### When an Angular component is destroyed

Streamix’s compiled Angular integration connects view cleanup to
`DestroyRef`. When the component is destroyed it removes source-reference
observers, destroys compiled bindings and structural blocks, cancels
scheduled rendering, and releases binding subscriptions.

These actions detach the view’s consumers. Producer shutdown then follows the
same ownership rules: a shared source can continue for another component,
while a flow losing its last owner stops.

Automatic cleanup covers the compiled bindings. A subscription created
manually in component code needs its own lifecycle connection:

```ts
const destroyRef = inject(DestroyRef);

const unsubscribe = source.subscribe(value => {
  // Handle value.
});

destroyRef.onDestroy(() => {
  void unsubscribe();
});
```

Manually managed iterators also need explicit closure.

### When an async iterator is abandoned

#### Exiting a `for await` loop

Exiting a `for await` loop with `break`, an enclosing `return`, or an
exception thrown in the loop body invokes and awaits the iterator’s
`return()` method when available:

```ts
for await (const value of iterate(source)) {
  if (enough(value)) {
    break;
  }
}
```

For `iterate(atom)`, closure clears buffered values, detaches the
subscription, and settles outstanding pulls.

#### Manual iteration

Manual iteration needs an explicit cleanup boundary:

```ts
const iterator = iterate(source);

try {
  const first = await iterator.next();
  // Use first.
} finally {
  await iterator.return?.();
}
```

Simply dropping the iterator variable or no longer calling `next()` sends no
cancellation notification. An active subscription and its resources can remain
alive. Garbage collection is not a deterministic teardown mechanism.

### Completion, finalization, and disposal

Operators can initiate cleanup too:

- `take(n)` closes its upstream source as soon as it receives the nth value.
- `finalize(callback)` runs its callback on completion, error, or explicit
  iterator closure.

For a broader cleanup boundary, dispose of the output atom:

```ts
await output.dispose();
```

Disposal stops production and releases the atom’s subscriptions and disposal
handlers. It does not indiscriminately dispose an upstream source that still
has other owners.

## 2. Backpressure

**Yes, producers can outpace consumers.** A producer is never paced by its
consumers: it runs at the source’s pace. Slow consumers accumulate values in
their own delivery queues (or see coalesced values). The atom’s `.value`
always reflects the newest emission. Consumers cannot block a producer.

### Delivery mode (the primary control)

Shared sources and flows expose an explicit delivery mode:

```ts
const positions = flow(pointerPositions(), { mode: "analog" }); // latest pending value
const clicks    = flow(clickEvents(),      { mode: "discrete" }); // every event
```

- `mode: "discrete"` (default) preserves every emission.
- `mode: "analog"` keeps only the latest pending value (ideal for pointer,
  scroll, or other high-frequency signals where intermediate values do not
  matter).

`createSharedSource` uses the same modes and, under the hood, a cyclic buffer
(default capacity 16 for discrete, 1 for analog). Analog overwrites the single
slot; discrete tries to preserve values.

There is **no public per-consumer `capacity` / `overflow` option** on
`subscribe()` or `iterate()` in the current API. Buffering and coalescing are
handled by the delivery mode and the runtime’s internal event buffers.

### There is no blocking backpressure

If a slow consumer must not lose values, do not rely on the producer to
pause. Prefer:

- an analog source when only the latest value matters, or
- operator-level shaping (`buffer`, `bufferCount`, `debounce`, `throttle`,
  `sample`) which changes the rate downstream without blocking the source, or
- making the producer itself pace (await inside the generator).

## 3. Error and completion

In RxJS an error terminates an Observable. In Streamix **failure is a state
the atom carries**, and termination is a policy:

```ts
const status = atom("idle", {
  onError: handler,           // source and subscriber failures
  terminateOnError: false,    // true disposes the atom after a producer/formula failure
  propagateErrors: false,     // true rethrows after handlers run
});
```

### Failure

- A producer or formula failure sets `.error`, makes `.value` throw, and
  notifies `onError` handlers. The atom stays undisposed unless
  `terminateOnError: true`.
- `.safeValue` never throws; it returns the last retained value (or the
  `NO_INITIAL_VALUE` sentinel before the first emission).
- Subscriber callback failures are isolated: other subscribers keep receiving
  values and the atom’s `.error` stays empty. For compatibility, `onError`
  handlers also observe subscriber failures.
- Writable atoms and flows leave the error state through `recover()` /
  `clearError()`; `next(value)` after recovery publishes normally.
  `fail(error, { terminate: true })` enters the state terminally.
- Derived atoms always record errors; the first failure invalidates downstream
  formulas, whose reads rethrow. The next successful upstream emission restores
  them.

### Iterators

`next()` rejects while the atom is in its error state, after any accepted
values have been drained. An iterator retains the terminal error it observed
even if the atom later recovers, so one consumer’s iteration ends
deterministically while the atom keeps serving others.

### Completion

A completed producer ends iteration with `{ done: true }`; it does not
dispose the atom. The atom retains its final value, late subscribers replay
it, and late iterators replay it once before finishing. A completed
`from([1, 2, 3])` gives a late consumer only `3` — the current value, not a
replay of the sequence.

### Mapping RxJS error handling

| RxJS mental model                  | Streamix                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe(next, error, complete)` | `subscribe(value => …)`; failures through `onError`; completion through iterator `done`                                                                         |
| An error terminates the stream     | Failure sets `.error`; the atom stays usable unless `terminateOnError`                                                                                          |
| `throwError(err)` as a source      | `throwError(message)` is an **operator** that errors when the source emits                                                                                      |
| `catchError(() => of(fallback))`   | `catchError(handler)` runs the handler on the first error and completes without a value; wrap the source in a generator to emit a fallback                      |
| `retry(n)` operator                | `retry(factory, maxRetries = 3, delay = 1000)` restarts the whole factory per attempt; values from failed attempts stay visible; its wait observes cancellation |
| `finalize(cb)`                     | `finalize(cb)` runs on completion, error, or explicit iterator closure                                                                                          |
| `firstValueFrom` / `lastValueFrom` | Same names; they reject when the source completes without a value                                                                                               |


## 4. Hot versus cold, multicasting, and scheduling

Streamix has no separate Observable type: `pipe()` and every factory produce
an atom, and **atoms are stateful**. Every non-disposed atom that has emitted
replays its current value to a new subscriber before future emissions. A plain
atom therefore behaves more like an RxJS `BehaviorSubject` (or a source shared
with `shareReplay(1)`) than like a cold Observable.

### One producer per atom

- `flow(factory)`, `from(value)`, and `defer(factory)` create one producer
  per atom instance. The factory runs when the producer activates (first
  subscriber / first pull), not once per subscriber. All subscribers share
  that single producer.
- Cold behaviour lives in the *factory call*: each call to `flow(...)`,
  `interval(...)`, `from(...)`, etc. creates a separate cold-to-hot instance
  with its own producer and state.
- After the last consumer leaves (or the producer completes), the producer
  stops and the atom freezes. A later subscriber replays the retained value
  but does **not** restart the producer.

### Multicasting

Streamix multicasts in three related ways:

1. **Every atom is already a multicast point**  
   Subscribing or iterating an atom never re-runs its producer. New consumers
   receive the current value (if any) and then live emissions. This is the
   default for `pipe()`, `flow()`, writable atoms, and derived atoms.

2. **Shared sources (resource-level multicasting)**  
   Factories such as `timer`, `interval`, `addListener`, DOM `on`, and the
   lower-level `createSharedSource` own one underlying resource. They are
   ref-counted:
   - first consumer starts the resource,
   - last consumer leaving stops it and runs cleanup.
   Delivery mode (`analog` / `discrete`) and an optional ring-buffer capacity
   are configured once on the shared source; every consumer sees the same
   sequence (or the same coalesced latest value).

3. **Pipeline operators `share()` and `shareReplay()`**  
   - `share()` connects to the upstream source the first time the shared
     pipeline is consumed. It disconnects (calls upstream `return()`) only
     when the *last* consumer calls `return()`.  
     Important: a consumer-injected `throw()` does **not** release the
     shared connection — only `return()` is treated as definitive teardown,
     because an injected error may be recoverable. An upstream failure, by
     contrast, fails and disposes the shared atom.
   - `shareReplay(n)` does the same connection/disconnection bookkeeping and
     additionally keeps a bounded history so late consumers receive the last
     *n* values before live emissions.
   - Without `share` / `shareReplay`, each independent `for await` (or each
     `pipe` that is not shared) over a cold iterable obtains its own upstream
     iterator.

Multi-source topologies are provided by factories and higher-order operators:
`merge`, `concat`, `zip`, `combineLatest`, `race`, `forkJoin`, and
`mergeMap` / `switchMap` / `concatMap` / `exhaustMap`. These also share the
underlying sources according to the rules above once the sources themselves
are atoms or shared sources.

### Scheduling and time

- Time operators use the real clock: `timer(delay, interval?)` and
  `interval(ms)` are shared sources over `setTimeout` / `setInterval`;
  `debounce`, `throttle`, `delay`, and `sample` use real timers too.
- There is **no RxJS-style scheduler parameter** on those operators. For
  deterministic tests, install fake timers (`jasmine.clock()`,
  `vi.useFakeTimers()`) before creating the atom.
- `observeOn('microtask' | 'macrotask' | 'idle')` selects the task queue a
  value is delivered on; values produced before the first subscriber
  attaches are dropped, so pair it with `shareReplay` when replay matters.
- `setScheduler` / `getScheduler` replace the runtime’s **propagation**
  scheduler (the depth-ordered flush of reactive updates), not timer
  scheduling. `transaction(fn)` batches several writes so downstream
  formulas publish once.
- `mode: "analog"` versus `"discrete"` is the scheduling-like choice that
  matters most for event sources: analog conflates to the latest pending
  value, discrete preserves every event.
