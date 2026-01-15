# 🧵 Subjects

Subjects are hot, push-based streams that expose the same `Stream` surface while letting you imperatively `next`, `complete`, or `error`. A single execution context broadcasts every emission to all active subscribers, and each emission is stamped to keep ordering deterministic even when downstream handlers return promises.

## 🎯 Core Characteristics

- **Multicast broadcasting** – the subject maintains one execution context so every active subscriber receives each emission in lockstep.
- **Global readiness gate** – the commit loop only advances when `ready.size === receivers.size`, so every listener must finish consuming (and rejoin the ready set) before the next value is emitted, even if they buffer asynchronously.
- **Imperative producer API** – `next`, `complete`, and `error` push stamped queue items through the shared commit loop for consistent delivery.
- **Late terminal replay** – subscribers who join after completion or error immediately observe the stored terminal stamp and handler result.

## ⏳ Emission stamping and delivery

Each producer call records an emission stamp. `createTryCommit` pulls the next queued item only when every receiver is ready and delivers it inside that stamp, so re-entrancy is avoided and async handler promises re-add their receiver to the ready set once resolved.

## 🔌 Subscription lifecycle

- **Subscribe** with a `Receiver` or callback to obtain a `Subscription` with `unsubscribe()`.
- **Per-receiver queuing** – `createReceiver` serializes `next` invocations per receiver, buffering values while a handler is running and deferring completion until the queue drains.
- **Unsubscribe cleanup** calls the receiver’s `complete()` so cleanup logic sees a deterministic stop.
- **Late subscribers** after terminal events immediately see the stored completion or error.

## 🔁 Lazy async iterator with true backpressure

```ts
for await (const value of subject) {
  // Buffered values are stamped and delivered in order.
}
```

- **Lazy registration** – the iterator subscribes only on the first `next()` call.
- **Iterator-level buffering** lets the iterator manage its own backpressure without pausing the subject for other subscribers.
- **Clean termination** – breaking or returning from the iterator detaches it without completing the subject, so other subscribers stay live.

## 📊 Value access helpers

- **`value` getter** exposes the latest emission (or `undefined` for the base subject before anything emits).
- **`query()`** is a `firstValueFrom`-style helper that resolves with the next emitted value and immediately unsubscribes.

## ⚠️ Error handling

- **Receiver errors** are handled locally; `receiver.error()` runs without forcing the subject to terminate unless it was already terminal.
- **Explicit `error(err)`** transitions the subject into an errored terminal state stamped like any other emission.
- **Late subscriber errors** deliver the stored error immediately upon registration.

## ❤️ `createBehaviorSubject(initialValue)`

`BehaviorSubject` seeds the subject with an initial value, stores the latest value in `latestValue`, and replays it synchronously to every new subscriber before they join the live commit loop. Behavior subjects share the same commit logic but always have a concrete current state.

- `value` never returns `undefined` because the subject always retains its seeded state.
- New subscribers immediately receive the current snapshot before future emissions.
- Useful for state propagation where every consumer needs the current value upfront.

## 🌀 `createReplaySubject(capacity = Infinity)`

`ReplaySubject` retains a sliding buffer of the most recent `{ value, stamp }` entries and replays them to late subscribers before handing them off to the live flow.

- **Replayed history** is drained in order; async handlers are honored by cursor-based replay so promises can settle before continuing.
- **Capacity** bounds history length and drops the oldest entries when the buffer exceeds the limit.
- **Terminal replays** deliver completion or errors immediately after the buffer drains, even for subscribers that join after the terminal event.

Use replay subjects when new subscribers need to catch up on recent history before resuming live emissions.

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
