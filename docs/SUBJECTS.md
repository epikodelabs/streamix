# 🧵 Subjects

Subjects are hot, push-based streams that expose the full `Stream` surface while letting you imperatively `next`, `complete`, or `error`. A single execution context broadcasts every emission to all active subscribers, but each receiver handles its own backpressure by buffering when its `next` handler returns a promise. Internally, each emission is stamped so ordering stays deterministic even when receivers resolve asynchronously.

## 🎯 Core Characteristics

- **Multicast broadcasting** – the subject maintains one execution, so every subscriber receives each emission at the same time the emitter pushes it.
- **Per-receiver flow control (with a global readiness gate)** – each receiver buffers while its handler resolves, but the commit loop still waits until `ready.size === receivers.size` before advancing, so every emission pauses until all listeners rejoin the ready set.
- **Imperative producer API** – values, completion, and errors are stamped and queued through the shared commit loop before delivery.
- **Late terminal replay** – subscribers who join after completion or error immediately see the terminal notification delivered with the stored stamp.

## ⏳ Emission stamping and delivery

Every `next`, `complete`, or `error` call records an emission stamp that downstream utilities (subjects, iterators, operators) use to enforce ordering and avoid re-entrancy. The commit loop pushes each stamped item to ready receivers, and receivers that return promises drop out of the ready set until their async work settles.

The gate that drives each emission is *global*: the loop only advances when `ready.size === receivers.size`, so the next queued item waits until every registered receiver has consumed (and, if needed, asynchronously resolved) the current value. That keeps the subject synchronized with every consumer, even though each receiver manages its own backpressure by re-adding itself to `ready` after finishes.

## 🔌 Subscription lifecycle

- **Subscribe** with `receiver` or `callback` to get a `Subscription` that can be cancelled with `.unsubscribe()`.
- **Unsubscribe cleanup** removes the receiver and immediately calls its `complete()` handler so cleanup logic sees a deterministic stop.
- **Late subscribers** after completion or error receive the terminal notification and no further values.

## 🔁 Lazy async iterator with true backpressure

```ts
for await (const value of subject) {
  // iterator-level buffering and stamping preserves ordered delivery
}
```

- **Lazy registration** – the iterator only subscribes when `next()` is called, deferring work until consumption begins.
- **Iterator-level buffering** isolates the iterator’s backpressure without pausing the subject for other subscribers.
- **Clean termination** – breaking the loop or calling `return()` detaches the iterator without completing the subject, so other subscribers stay live.

## 📊 Value access helpers

- **`value` getter** provides synchronous access to the most recent emission (or `undefined` for the base subject before anything is emitted).
- **`query()`** is implemented with `firstValueFrom` and resolves with the next emitted value, great for one-shot sampling.

## ⚠️ Error handling

Errors are stamped and delivered like values:

- **Receiver errors** stay local to the receiver: `receiver.error()` runs without forcing the subject to terminal state.
- **Explicit `error(err)`** transitions the subject to an errored terminal state and notifies all subscribers.
- **Late subscribers** immediately observe the stored error when they subscribe after an explicit error.

## ❤️ `createBehaviorSubject(initialValue)`

`BehaviorSubject` is the stateful variant: it caches the latest value in `latestValue` and replays it synchronously to any newly registered receiver before joining the live commit loop. As a result:

- `value` never returns `undefined` after creation because there is always a seeded state.
- Late subscribers immediately receive the current snapshot before any further values.
- All other behaviors (async iterator, terminal handling, commit loop) are shared with the base subject.

Use `BehaviorSubject` whenever each consumer needs the latest “current state” immediately.

## 🌀 `createReplaySubject(capacity = Infinity)`

`ReplaySubject` keeps a sliding buffer of past `{ value, stamp }` entries that it replays to newcomers before handing them off to the live flow.

- **Replayed history** is drained in order and respects asynchronous receiver handlers by continuing the replay via cursor-based steps when promises are returned.
- **Capacity** bounds how many entries are stored; older items drop off when the buffer exceeds the limit.
- **Terminal replays** deliver completion or errors immediately after replay finishes, even for subscribers that appear after the terminal event.

Ideal for “catching up” new subscribers with recent history before mixing them into ongoing emissions.

## 🎭 Usage patterns

```ts
const events = createSubject<{ type: string }>();
events.subscribe(event => console.log("Logger:", event));
events.subscribe(event => sendToAnalytics(event));
events.next({ type: "ready" });

const state = createBehaviorSubject({ user: null });
state.subscribe(s => updateUi(s));
state.next({ user: "alice" });
console.log(state.value); // { user: "alice" }

const logger = createReplaySubject<string>(3);
logger.next("a");
logger.next("b");
logger.subscribe(async v => {
  await writeToDisk(v);
});
```

<p align="center">
  <strong>Ready to stream? Get started with Streamix today! 🚀</strong><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> 📦 
  <a href="https://github.com/actioncrew/streamix">View on GitHub</a> 🐙 
  <a href="https://forms.gle/CDLvoXZqMMyp4VKu9">Give Feedback</a>
</p>

---

*Choose your tools wisely, keep it simple, and may your reactive pipelines be pragmatic and interoperable. 💡*
