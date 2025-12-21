# Type Alias: Stream\<T\>

> **Stream**\<`T`\> = `AsyncIterable`\<`T`\> & `object`

Defined in: [abstractions/stream.ts:23](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/stream.ts#L23)

A reactive stream representing a sequence of values over time.

Streams support:
- **Subscription** to receive asynchronous values.
- **Operator chaining** through `.pipe()`.
- **Querying** the first emitted value.
- **Async iteration** via `for await...of`.

Two variants exist:
- `"stream"`: automatically driven, typically created by `createStream()`.
- `"subject"`: manually driven (not implemented here but retained for API symmetry).

## Type declaration

### type

> **type**: `"stream"` \| `"subject"`

Identifies the underlying behavior of the stream.

### name?

> `optional` **name**: `string`

Human-readable name primarily for debugging and introspection.

### id

> **id**: `string`

Internal unique identifier of the stream instance.

Used by runtime hooks (e.g. tracing, profiling, devtools).
Not part of the public reactive API.

### pipe

> **pipe**: `OperatorChain`\<`T`\>

Creates a new derived stream by applying one or more `Operator`s.

Operators compose into an async-iterator pipeline, transforming emitted values.

### subscribe()

> **subscribe**: (`callback?`) => [`Subscription`](Subscription.md)

Subscribes to the stream.

A callback or Receiver will be invoked for each next/error/complete event.
Returns a `Subscription` that may be used to unsubscribe.

#### Parameters

##### callback?

(`value`) => [`MaybePromise`](MaybePromise.md) | [`Receiver`](Receiver.md)\<`T`\>

#### Returns

[`Subscription`](Subscription.md)

### query()

> **query**: () => `Promise`\<`T`\>

Convenience method for retrieving the first emitted value.

Internally subscribes, resolves on the first `next`, and then unsubscribes.

#### Returns

`Promise`\<`T`\>

### \[asyncIterator\]()

> **\[asyncIterator\]**(): `AsyncGenerator`\<`T`\>

Allows direct async iteration: `for await (const value of stream) { ... }`.

#### Returns

`AsyncGenerator`\<`T`\>

## Type Parameters

### T

`T` = `any`

The value type emitted by the stream.
