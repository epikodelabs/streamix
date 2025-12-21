# Type Alias: Subscription

> **Subscription** = `object`

Defined in: [abstractions/subscription.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/subscription.ts#L14)

Represents a subscription to a stream-like source.

A `Subscription` is returned from a stream's `subscribe()` method and
represents an active connection between a producer and a consumer.

Responsibilities:
- Tracks whether the subscription is active
- Provides an idempotent mechanism to unsubscribe
- Optionally executes cleanup logic on unsubscribe

## Properties

### unsubscribed

> `readonly` **unsubscribed**: `boolean`

Defined in: [abstractions/subscription.ts:24](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/subscription.ts#L24)

Indicates whether the subscription has been terminated.

- `false` → subscription is active
- `true`  → subscription has been unsubscribed and is inactive

This flag becomes `true` immediately when `unsubscribe()` is invoked
for the first time.

***

### onUnsubscribe()?

> `optional` **onUnsubscribe**: () => [`MaybePromise`](MaybePromise.md)

Defined in: [abstractions/subscription.ts:55](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/subscription.ts#L55)

Optional cleanup callback executed during unsubscription.

Intended usage:
- Remove event listeners
- Cancel timers or async tasks
- Abort generators or observers

Guarantees:
- Called at most once
- Executed only after `unsubscribed` becomes `true`
- May be synchronous or asynchronous

Any errors thrown by this callback are caught internally.

#### Returns

[`MaybePromise`](MaybePromise.md)

## Methods

### unsubscribe()

> **unsubscribe**(): `any`

Defined in: [abstractions/subscription.ts:38](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/subscription.ts#L38)

Terminates the subscription.

Semantics:
- Idempotent: calling multiple times has no additional effect
- Marks the subscription as unsubscribed synchronously
- Executes cleanup logic (if provided) exactly once

Errors thrown by cleanup logic are caught and logged.

#### Returns

`any`

A `MaybePromise<void>` that resolves when cleanup completes
