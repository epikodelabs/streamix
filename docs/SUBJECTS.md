# 🧵 Subject

A push-based multicast stream that broadcasts values to multiple subscribers while coordinating global async backpressure. Think of it as a single source of truth that can notify many listeners, waiting for all of them to be ready before moving forward.

## 🎯 Core Characteristics

**Multicast Broadcasting**  
Unlike typical streams that create a new execution for each subscriber, a Subject maintains a single execution context. When you emit a value, all active subscribers receive it simultaneously.

**No Replay**  
Subscribers only receive values emitted after they subscribe. There's no built-in replay buffer—late subscribers start fresh from the moment they connect.

**Per-receiver Backpressure (not global)**  
The Subject does not wait for all subscribers to finish async work before emitting the next value. Instead, backpressure is handled at the *receiver* level: if a receiver's `next` handler returns a Promise, that receiver buffers subsequent values for itself until its async work completes. The Subject broadcasts values immediately to all subscribers and does not `await` their Promises collectively.

## ⏳ Emission stamping and delivery semantics

Producer operations (`next`, `complete`, `error`) are stamped and delivered in the emission context, which provides a predictable ordering for consumers. However, the Subject does not maintain a single global async queue that waits for every subscriber; stamping records an emission context used by internal utilities and iterators to preserve ordering and avoid re-entrancy issues.

How it works:
- Each emission is assigned an emission stamp to mark its context
- The Subject broadcasts the value to all active subscribers immediately (synchronously within the emission context)
- Individual receivers may buffer and resume their own processing if their handler returns a Promise, but the Subject itself does not await all receivers
- Terminal events (`complete`, `error`) are dispatched to subscribers in the same stamped context

This provides ordered delivery while keeping backpressure management localized to receivers rather than elevating it to a global Subject-level throttle.

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
The async iterator bridges push and pull styles by buffering values and exposing them via the iterator protocol. The iterator controls its own consumption (it will queue values when the consumer is slow), but the Subject itself does not pause globally waiting for the iterator. In short, the iterator participates in flow control from its own side; the Subject continues to emit to all subscribers.

**Buffering**  
If the Subject emits while the iterator isn't actively awaiting, values are buffered by the iterator implementation to avoid data loss. The iterator's buffering and stamping preserve ordering for the consuming loop.

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
Errors thrown inside a receiver are handled at the receiver level: the receiver's `error` handler is invoked and that receiver is completed. Such receiver-local errors do *not* automatically transition the Subject itself into an errored or terminal state.

**Explicit Errors**  
Calling `error(err)` on the Subject explicitly transitions the Subject to an errored (terminal) state and notifies all subscribers.

**Late Subscriber Errors**  
If a subscriber attaches after the Subject has been explicitly errored, it receives the terminal error immediately via its `error()` handler.

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