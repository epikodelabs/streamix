# Function: createSubscription()

> **createSubscription**(`onUnsubscribe?`): [`Subscription`](../type-aliases/Subscription.md)

Defined in: [abstractions/subscription.ts:69](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/subscription.ts#L69)

Creates a new `Subscription` instance.

This factory encapsulates subscription state and ensures:
- Safe, idempotent unsubscription
- Proper execution of cleanup logic
- Consistent error handling during teardown

## Parameters

### onUnsubscribe?

() => `any`

Optional cleanup callback executed on first unsubscribe

## Returns

[`Subscription`](../type-aliases/Subscription.md)

A new `Subscription` object
