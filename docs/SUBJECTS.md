# ⚡ Subjects

Subjects are hot, push-based streams that behave like every other `Stream` while letting you imperatively `next`, `complete`, or `error`. A single commit loop stamps each emission, keeps ordering deterministic, and makes sure late joins learn the terminal state instantly.

## 🚦 Core characteristics

- 🔁 **Multicast broadcasting** – every emission is sent once through the shared commit loop so all active subscribers observe it simultaneously.
- 🚦 **Global readiness gate** – the reporter only dequeues the next item when `ready.size === receivers.size`, which means no new emission starts until every receiver has finished processing the previous one (including any async work that re-adds the receiver to `ready` upon resolution).
- ⏸️ **Per-receiver flow control** – each subscriber runs through `createReceiver`, so slow handlers buffer values locally while the subject keeps advancing for the rest; once an async handler resolves, it rejoins the ready set and lets the next stamp commit.
- 🧱 **Imperative producer API** – `next`, `complete`, and `error` push stamped queue entries through `tryCommit`, so producers never race with delivery.
- 🏁 **Late terminal replay** – subscribers that register after completion or an error immediately see the stored terminal stamp and notification before returning their `Subscription`.

## 🧭 Emission stamping and delivery

Every producer call records a monotonic stamp. `createTryCommit` clears entries only when every receiver is ready and reenters the commit loop once asynchronous reactions re-add themselves to `ready`. This keeps delivery deterministic even if downstream handlers return promises.

## 🔗 Subscription lifecycle

- 📥 **Subscribe** with a callback or full `Receiver` to get a callable `Subscription` (invoke it, or `await` it, to unsubscribe).
- 🧵 **Per-receiver queuing** – `createReceiver` serializes `next` calls, buffers values when the handler is running, defers completion until the queue drains, and defers each handler call via `queueMicrotask`.
- 🧹 **Unsubscribe cleanup** – removing a receiver triggers `complete()` inside a stamped emission so cleanup sees a deterministic stop.
- 🕒 **Late subscribers** – new receivers connect either to the pending queue or immediately replay the terminal stamp (complete/error) if the subject already finished.

## 🌀 Lazy async iterator with true backpressure

```ts
for await (const value of subject) {
  // Buffered values are stamped and delivered in order.
}
```

- 🧾 **Lazy registration** – the iterator only subscribes on the first `next()` invocation.
- ↔️ **Iterator-level buffering** – the iterator manages its own backpressure while the subject keeps emitting for other consumers.
- ✅ **Clean termination** – breaking or returning from the iterator detaches it without completing the subject, so other subscribers remain live.

## 📦 Value helpers

- 🔍 **`value` getter** exposes the latest emission (or `undefined` before anything emits).
- 🎯 **`query()`** acts like `firstValueFrom`, resolving with the next emission and immediately unsubscribing.

## ⚠️ Error handling

- 🔗 **Receiver errors** stay local; calling `receiver.error()` runs the handler without moving the subject into a terminal state unless `error(err)` was explicitly invoked.
- 🧨 **Explicit `error(err)`** stamps the terminal state just like any other emission, ensuring late subscribers immediately see the stored exception.
- 🌙 **Unhandled error logging** – errors thrown inside user handlers are caught, logged, and routed through the stamped lifecycle so the commit loop stays consistent.

## 🌱 `createBehaviorSubject(initialValue)`

`BehaviorSubject` seeds the stream with a value, keeps `latestValue` up to date, and replays the seed (and every new value) synchronously to each new subscriber before letting it join the live commit loop.

- 🤲 `value` never becomes `undefined` because the subject always retains the seeded state.
- 🔁 Late subscribers immediately receive the current snapshot before seeing future emissions.
- 💡 Ideal for propagating shared state where every consumer needs a warm start.

## 🔄 `createReplaySubject(capacity = Infinity)`

`ReplaySubject` keeps a sliding buffer of recent `{ value, stamp }` entries and replays them in order before handing the live flow back to the supplier.

- 📚 **Replayed history** drains in sequence; async handlers resolve in stamp order so replay respects their pacing.
- 📦 **Capacity** keeps the buffer bounded, trimming the oldest values when needed.
- 🚨 **Terminal replays** deliver completion or errors after the buffer drains, even for subscribers that join after the terminal stamp.

Use replay subjects when new subscribers must catch up before rejoining live emissions.

## 🧭 Usage patterns

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
  <strong>Ready to stream? Get started with Streamix today! ⚙️</strong><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> ⚡ 
  <a href="https://github.com/actioncrew/streamix">View on GitHub</a> 📦 
  <a href="https://forms.gle/CDLvoXZqMMyp4VKu9">Give Feedback</a> 💬
</p>

---

*Choose your tools wisely, keep it simple, and may your reactive pipelines be pragmatic and interoperable. 🤝*
