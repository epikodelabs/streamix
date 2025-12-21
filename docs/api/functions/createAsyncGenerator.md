# Function: createAsyncGenerator()

> **createAsyncGenerator**\<`T`\>(`register`): `AsyncGenerator`\<`T`\>

Defined in: [abstractions/stream.ts:117](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/stream.ts#L117)

Creates a pull-based async generator view over a stream.

This bridges the push-based subscription model with
the pull-based async-iterator protocol.

Characteristics:
- Buffers values when the producer is faster than the consumer
- Propagates errors via generator throws
- Guarantees subscription cleanup on completion, error, or early exit

## Type Parameters

### T

`T` = `any`

## Parameters

### register

(`receiver`) => [`Subscription`](../type-aliases/Subscription.md)

Function registering a receiver and returning a subscription

## Returns

`AsyncGenerator`\<`T`\>

AsyncGenerator yielding stream values
