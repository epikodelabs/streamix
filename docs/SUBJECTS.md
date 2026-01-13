# 🧵 Subject

A push-based multicast stream that broadcasts values to multiple subscribers while coordinating global async backpressure. Think of it as a single source of truth that can notify many listeners, waiting for all of them to be ready before moving forward.

## 🎯 Core Characteristics

**Multicast Broadcasting**  
Unlike typical streams that create a new execution for each subscriber, a Subject maintains a single execution context. When you emit a value, all active subscribers receive it simultaneously.

**No Replay**  
Subscribers only receive values emitted after they subscribe. There's no built-in replay buffer—late subscribers start fresh from the moment they connect.

**Global Backpressure**  
The Subject respects the pace of *all* its subscribers. If any subscriber returns a Promise (indicating async work), the Subject waits for that work to complete before emitting the next value. This prevents overwhelming slow consumers.

## ⏳ Serialized Emission Queue

All producer operations (`next`, `complete`, `error`) are queued and processed sequentially. This design eliminates race conditions and ensures predictable order of operations.

**How it works:**
1. Each call to `next()`, `complete()`, or `error()` enqueues a task
2. The queue drains one task at a time in FIFO order
3. For each `next` emission, the Subject delivers the value to all active subscribers
4. If any subscriber returns a Promise, the Subject awaits `Promise.all()` before continuing
5. Terminal events (`complete`, `error`) are processed through the same queue, ensuring reliable delivery

This serialization guarantees that even if multiple producers call `next()` concurrently, emissions arrive at subscribers in a well-defined order without interleaving.

## 🔌 Subscription Lifecycle

**Subscribing**  
Call `subscribe(receiver)` or `subscribe(callback)` to register a new subscriber. Returns a `Subscription` object with an `unsubscribe()` method.

**Unsubscribing**  
When you unsubscribe, two things happen:
- The receiver is removed from the active subscriber list
- The receiver's `complete()` method is called to signal cleanup

This explicit completion on unsubscribe helps subscribers release resources and perform cleanup logic.

**Late Subscribers**  
If you subscribe after the Subject has completed or errored, your receiver immediately receives the terminal notification. No values are delivered, just the terminal state.

## 🔁 Lazy Async Iterator with True Backpressure

The async iterator provides a pull-based interface over the push-based Subject:
```typescript
for await (const value of subject) {
  // Process value
}
```

**Lazy Attachment**  
The iterator doesn't register as a subscriber until you call `next()` for the first time. This defers work until you actually start consuming values.

**Backpressure Participation**  
Once attached, the iterator actively participates in backpressure. The Subject won't emit the next value until the iterator signals readiness by requesting another value. This creates natural flow control—the Subject moves at the pace of iteration.

**Buffering**  
If the Subject emits while the iterator isn't actively awaiting, values are buffered internally. This prevents data loss while maintaining backpressure semantics.

**Clean Termination**  
- Breaking from the loop or calling `return()` detaches the iterator without completing the Subject
- Other subscribers continue receiving values normally
- The Subject remains active for remaining subscribers

## 📊 Value Access

**`value` getter**  
A synchronous property that returns the most recently emitted value, or `undefined` if no value has been emitted yet. Useful for inspecting current state without subscribing.

**`query()` method**  
An async method that resolves with the next emitted value. Essentially a one-shot subscription implemented via `firstValueFrom` semantics. Perfect for when you need just one value from the stream.

## ⚠️ Error Handling

Errors propagate through the same serialized queue as values:

**Receiver Errors**  
If any receiver throws an error during emission, the Subject catches it, transitions to an errored state, and notifies all active subscribers with the error. The Subject becomes terminal—no further emissions are possible.

**Explicit Errors**  
Calling `error(err)` explicitly transitions the Subject to an errored state, notifying all subscribers and making the Subject terminal.

**Late Subscriber Errors**  
Subscribers who join after an error immediately receive the error notification through their `error()` method.

## 🎭 Usage Patterns

**Event Bus**
```typescript
const events = createSubject();
events.subscribe(event => console.log('Logger:', event));
events.subscribe(event => sendToAnalytics(event));
events.next({ type: 'user_login', userId: 123 });
```

**State Management**
```typescript
const state = createSubject();
state.subscribe(newState => updateUI(newState));
state.next({ user: currentUser, theme: 'dark' });
console.log(state.value); // Check current state
```

**Coordinated Async Processing**
```typescript
const tasks = createSubject();
tasks.subscribe(async task => {
  await processTask(task); // Subject waits for this
});
tasks.subscribe(async task => {
  await logTask(task); // And waits for this too
});
tasks.next(newTask); // Won't proceed until both complete
```

---

<p align="center">
  <strong>Ready to stream? Get started with Streamix today! 🚀</strong><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> 📦 
  <a href="https://github.com/actioncrew/streamix">View on GitHub</a> 🐙 
  <a href="https://forms.gle/CDLvoXZqMMyp4VKu9">Give Feedback</a>
</p>

---

*Choose your tools wisely, keep it simple, and may your reactive pipelines be pragmatic and interoperable. 💡*