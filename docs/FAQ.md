# Streamix FAQ

Answers to the questions that come up when adopting Streamix, each grounded
in the runtime's actual behavior (current main / v3 atom & flow model).

## Contents

1. [Cancellation and teardown: what happens when a consumer stops early, and what survives after the last owner leaves?](#1-cancellation-and-teardown)
2. [Backpressure: which sources pace their producers, and how is buffering or coalescing selected?](#2-backpressure)
3. [Error and completion: how exceptions, terminal states, and completion replay map from the RxJS mental model.](#3-error-and-completion)
4. [Hot versus cold, multicasting, and scheduling: when is a producer shared, and how do time-based operators behave?](#4-hot-versus-cold-multicasting-and-scheduling)

## 1. Cancellation and teardown

Streamix treats cancellation as a question of **ownership**. A consumer can
detach without shutting down a source that others still use. When the last
owner leaves, production stops for flow-backed atoms and shared sources. What
survives afterwards depends on the source kind: a flow atom is disposed, a
shared source can reconnect for a new consumer, and a writable atom stays
alive.

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

What happens after the last consumer leaves depends on the source kind:

| Source kind      | What stops                                       | A later subscriber                                                                                                                       |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Flow-backed atom | The producer stops; the flow atom is disposed    | Gets nothing and does not restart it. `.safeValue` keeps the last value; `.value` throws `Atom has been disposed`.                        |
| Shared source    | The underlying resource stops; the source stays alive | Gets the current value and reconnects the resource. If the source already completed, it gets the current value but no reconnect.         |
| Writable atom    | Nothing — the atom stays alive                   | Gets the current value; the atom remains writable.                                                                                       |

A pipeline that is actively consuming the atom counts as one of its consumers:
`pipe(atom, ...)` holds an active consumer on the source while the output atom
is consumed, so the source stops only after every pipeline and direct
subscriber has detached (a flow atom is then disposed; a shared source stays
available for a later consumer). Two caveats:

- A `pipe()` over a flow or writable atom does not subscribe to it until the
  output atom is consumed, so constructing the pipeline alone does not keep
  the source alive. Pipes over shared sources, and operators that connect
  eagerly such as `share()` and `observeOn`, start pulling at construction
  instead. If the source disposes before an unstarted pipeline consumes it,
  the pipeline starts from `done`.
- A `derived()` dependency is tracked through change handlers, not a
  subscription, so it neither counts as an owner nor starts a flow or shared
  source by itself.

If a flow atom is disposed manually while another pipeline still consumes it,
the disposal propagates as completion: the downstream iterator ends with
`done` (after draining already-buffered values) and the pipeline disposes
itself. Disposing a shared source rejects its pending iterator pulls with
`Source disposed`; later pulls finish with `done`.

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

**It depends on the source model.** Flow-backed atoms run at the source’s
pace: consumers cannot block the producer. Shared sources are push-based —
their `connect` function receives a `PushSink` whose `next()` is awaitable —
so a producer that awaits it **is** paced by consumers. That is the runtime’s
only blocking backpressure.

| Source kind                                                                   | Producer paced by consumers?                      | Slow consumer behavior                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Flow-backed (`flow`, `pipe`, `from`, …)                                        | No                                                 | Per-subscriber FIFO queue (unbounded); `mode: "analog"` keeps only the latest pending value                                         |
| Shared source (`fromPush`, `timer`, `interval`, `addListener`, DOM)            | Yes, when `connect` awaits `sink.next()` in discrete mode | `next()` waits for buffer space and for subscriber callbacks to finish; async iterators queue values instead of applying backpressure |

The atom’s `.value` always reflects the newest emission.

### Delivery mode (the primary control)

Flows and shared sources expose the same delivery mode:

```ts
const positions = flow(pointerPositions(), { mode: "analog" }); // latest pending value
const clicks    = flow(clickEvents(),      { mode: "discrete" }); // every event
```

- `mode: "discrete"` (default) preserves every emission.
- `mode: "analog"` keeps only the latest pending value (ideal for pointer,
  scroll, or other high-frequency signals where intermediate values do not
  matter).

Shared sources also own a single cyclic buffer with an optional `capacity`:

| Mode       | Default capacity | Full-buffer behavior                          |
| ---------- | ---------------- | --------------------------------------------- |
| `discrete` | 16               | `push` waits for a free slot (producer waits) |
| `analog`   | 1                | Overwrites the pending slot (latest wins)     |

Flows have no source-side buffer — `mode: "analog"` conflates each
subscriber’s pending queue instead. Keeping the queue per-subscriber preserves
fan-out isolation: one slow subscriber on a flow does not stall the source or
the other subscribers.

There is **no public per-consumer `capacity` / `overflow` option** on
`subscribe()` or `iterate()` in the current API. Buffering and coalescing are
handled by the delivery mode and the runtime’s internal buffers.

### Blocking backpressure (shared sources only)

A push-based producer can be paced, but only cooperatively:

- In **discrete** mode, `push(value)` settles after the ring buffer accepts
  the value and subscriber callbacks finish processing it. Promise-returning
  callbacks are awaited, so a slow async subscriber delays `push` — and, for
  `timer` / `interval`, the next tick. Because distribution is shared, that
  subscriber also delays every other consumer.
- In **analog** mode, `push` overwrites the latest pending value and returns
  immediately; consumers never slow the producer.

DOM event sources cannot be paced by the browser: `addEventListener` ignores
the listener’s returned promise. Awaiting `push` in discrete mode preserves
events by queueing pending listener invocations, so memory grows with the
backlog regardless of the ring-buffer `capacity`. Use `mode: "analog"` for
high-frequency streams; pointer and scroll streams already do.

### Subscriber queues and iterators

On atom-backed sources (writable atoms, flows, derived atoms), each
subscription owns a private pending queue:

- An async callback is **never re-entered**; later values wait until the
  previous invocation settles.
- Default (discrete) delivery is FIFO and lossless for the life of the
  subscription.
- Analog delivery keeps only the latest pending value for a busy subscriber.

`atom.next()` / `.set()` are synchronous and never wait for subscribers.

`iterate()` and `for await` own a separate per-iterator buffer: discrete values
queue without a bound, analog atoms conflate into it. Consuming slowly never
pressures a flow producer, and it does not pressure a shared-source producer
either — a shared source’s ring buffer drains into this queue, so only async
subscriber callbacks suspend its producer.

### Choosing a mode

- **Every event matters and the producer can wait:** keep the default
  `discrete` mode. Built-in timer sources await `push`; a custom `connect`
  should do the same so a full buffer suspends the producer.
- **Only the latest value matters, or the producer cannot wait (DOM):** use
  `analog`; intermediate values are conflated and the producer never blocks.
- **A flow producer must not outrun its consumer:** do not rely on the runtime
  to pause it. Use `mode: "analog"`, operator-level shaping (`buffer`,
  `bufferCount`, `debounce`, `throttle`, `sample`), or make the producer pace
  itself (await inside the generator).

## 3. Error and completion

In RxJS an error terminates an Observable. In Streamix **failure is a state
the atom carries**, and termination is a policy:

```ts
const status = atom("idle", {
  onError: handler,           // producer / formula failures
  terminateOnError: false,    // true disposes the atom after a producer/formula failure
  propagateErrors: false,     // true rethrows after handlers run
});
```

### Failure

- A producer or formula failure sets `.error`, makes `.value` throw, and
  notifies `atom.onError()` observers (writable atoms and flows also call the
  constructor `onError` option). The atom stays undisposed unless
  `terminateOnError: true`; a flow atom’s producer stops.
- `.safeValue` never throws; it returns the last retained value (or the
  `NO_INITIAL_VALUE` sentinel before the first emission).
- Subscriber callback failures are isolated: other subscribers keep receiving
  values and the atom’s `.error` stays empty. `atom.onError()` observers see
  them; the constructor `onError` option does not.
- Writable atoms leave the error state through `recover()` / `clearError()`;
  `next(value)` after recovery publishes normally. `fail(error, { terminate:
  true })` enters the state terminally. Flow atoms expose no recovery API: a
  failed producer has stopped, so create a new flow (or use `retry`).
- Derived atoms always record errors; the first failure invalidates downstream
  formulas, whose reads rethrow. The next successful upstream emission restores
  them.

### Iterators

`next()` rejects while the atom is in its error state, after any accepted
values have been drained. An iterator retains the terminal error it observed
even if the atom later recovers, so one consumer’s iteration ends
deterministically while the atom keeps serving others.

### Completion

A completed producer ends iteration with `{ done: true }`. What a late
consumer observes depends on the source kind:

| Completed source | Late `subscribe()`              | Late `for await` (direct)                  |
| ---------------- | ------------------------------- | ------------------------------------------ |
| Flow-backed atom | Nothing — the atom is disposed  | Finishes immediately with `{ done: true }` |
| Shared source    | The current value once (if any) | Finishes immediately; no replay            |
| `from([...])`    | Replays the whole sequence      | Replays the whole sequence                 |

`flow()` completion disposes the atom, but `.safeValue` still returns the final
value. `from([...])` deliberately caches its resolved items and replays them
to late consumers; that is the exception to the “current value only” rule.

### Mapping RxJS error handling

| RxJS mental model                  | Streamix                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe(next, error, complete)` | `subscribe(value => …)`; failures through `onError`; completion through iterator `done`                                                                         |
| An error terminates the stream     | Failure sets `.error`; writable atoms stay usable, flow atoms stop their producer unless `terminateOnError`                                                     |
| `throwError(err)` as a source      | `throwError(message)` is an **operator** that errors when the source emits                                                                                      |
| `catchError(() => of(fallback))`   | `catchError(handler)` runs the handler on the first error and completes without a value; wrap the source in a generator to emit a fallback                      |
| `retry(n)` operator                | `retry(factory, maxRetries = 3, delay = 1000)` restarts the whole factory per attempt; values from failed attempts stay visible; its wait observes cancellation |
| `finalize(cb)`                     | `finalize(cb)` runs on completion, error, or explicit iterator closure                                                                                          |
| `firstValueFrom` / `lastValueFrom` | Same names; they reject when the source completes without a value                                                                                               |


## 4. Hot versus cold, multicasting, and scheduling

Streamix has no separate Observable type: `pipe()` and every factory produce
an atom, and **atoms are stateful**. Every non-disposed atom that has emitted
replays its current value to a new subscriber before future emissions
(`from([...])` is the exception: it replays its cached sequence). A plain atom
therefore behaves more like an RxJS `BehaviorSubject` (or a source shared with
`shareReplay(1)`) than like a cold Observable.

### One producer per atom

- `flow(factory)`, `from(value)`, and `defer(factory)` create one producer
  per atom instance. The factory runs when the producer activates (first
  subscriber / first pull), not once per subscriber. All subscribers share
  that single producer.
- Cold behaviour lives in the *factory call*: each call to `flow(...)`,
  `interval(...)`, `from(...)`, etc. creates a separate cold-to-hot instance
  with its own producer and state.
- After the last consumer leaves, an ordinary flow-backed atom is disposed: a
  later subscriber gets no replay and does not restart the producer
  (`.safeValue` still exposes the final value). `from([...])` is the exception:
  it replays its cached sequence.

### Multicasting

Streamix multicasts in three related ways:

1. **Every atom is already a multicast point**  
   Subscribing or iterating an atom never re-runs its producer. New consumers
   receive the current value (if any) and then live emissions. This is the
   default for `pipe()`, `flow()`, writable atoms, and derived atoms.

2. **Shared sources (resource-level multicasting)**  
   Factories such as `timer`, `interval`, `addListener`, DOM `on`, and the
   lower-level `fromPush` own one underlying resource. They are
   ref-counted: the first consumer starts the resource, the last consumer
   leaving stops it and runs cleanup, and a new consumer reconnects it (unless
   the source already completed).

   Delivery mode (`analog` / `discrete`) and an optional ring-buffer capacity
   are configured once on the shared source; concurrently attached consumers
   see the same sequence (or the same coalesced latest value). A late consumer
   sees only the current value, and a shared source allows **one active async
   iterator at a time** — a second `for await` over the source finishes
   immediately. Use multiple `subscribe()` callbacks, or `iterate()` (which
   subscribes), for concurrent iterator-style consumers.

3. **Pipeline operators `share()` and `shareReplay()`**  
   - `share()` connects when the operator is applied during `pipe()`
     construction, so it starts pulling the upstream source immediately —
     before the output atom gets its first subscriber. It disconnects (calls
     upstream `return()`) only when the shared iterator is returned, normally
     when the output atom loses its last subscriber.  
     Important: a consumer-injected `throw()` does **not** release the
     shared connection — only `return()` is treated as definitive teardown,
     because an injected error may be recoverable. An upstream failure, by
     contrast, fails and disposes the shared atom.
   - `shareReplay(n)` connects on the first pull and keeps a replay history so
     late consumers receive the last *n* values before live emissions (`n`
     defaults to `Infinity`, so the history is unbounded unless you pass a
     size).
   - Without `share` / `shareReplay`, separate `pipe()` calls over a cold
     iterable each create their own upstream iterator. Multiple consumers of
     the same pipe atom still share that pipe’s single producer.

Multi-source topologies are provided by factories and higher-order operators:
`merge`, `concat`, `zip`, `combineLatest`, `race`, `forkJoin`, and
`mergeMap` / `switchMap` / `concatMap` / `exhaustMap`. These also share the
underlying sources according to the rules above once the sources themselves
are atoms or shared sources.

### Scheduling and time

- Timers start on the first subscription, not when the factory is called.
  Streamix follows the RxJS `timer` / `interval` contract:

  | Source | First value (`0`) | Later values (`1`, `2`, ...) |
  | --- | --- | --- |
  | `timer(due)` | After `due` milliseconds | None; the source completes after emitting once |
  | `timer(due, period)` | After `due` milliseconds | Repeats every `period` milliseconds |
  | `interval(period)` | After `period` milliseconds | Repeats every `period` milliseconds |

  A zero first delay delivers asynchronously without advancing the clock.
  Unsubscribing the last consumer cancels a pending first delay or repeat
  wait. While consumers remain, they share the timer; a new subscriber first
  receives its current value when one exists.
- Time operators use the real clock: `timer(delay, interval?)` and
  `interval(ms)` are shared sources over recursive `setTimeout`;
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
