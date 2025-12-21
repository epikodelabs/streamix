# Function: fromPromise()

## Call Signature

> **fromPromise**\<`T`\>(`promise`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/fromPromise.ts:42](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/fromPromise.ts#L42)

Creates a stream that emits exactly one value and then completes.

This function supports two usage patterns:

### 1. Eager value or promise
When given a value or a promise, the stream will emit the resolved value
and then complete. If the promise rejects, the stream will emit an error.
The underlying promise itself is **not cancelable**.

### 2. Lazy, cancelable factory
When given a factory function, the factory is invoked on subscription
and receives an [AbortSignal](#). The signal is aborted when the stream
is unsubscribed, enabling cooperative cancellation of the underlying
asynchronous work.

In both cases, the stream emits exactly one value (if successful) and
then completes.

### Type Parameters

#### T

`T`

The type of the emitted value.

### Parameters

#### promise

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\>

A value or promise to convert into a stream.

### Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A stream that emits the resolved value and then completes.

## Call Signature

> **fromPromise**\<`T`\>(`factory`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/fromPromise.ts:60](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/fromPromise.ts#L60)

Creates a stream from a cancelable, lazy asynchronous factory.

The factory is invoked on subscription and receives an [AbortSignal](#)
that is aborted when the stream is unsubscribed. If the factory throws or
returns a rejected promise, the stream will emit an error.

### Type Parameters

#### T

`T`

The type of the emitted value.

### Parameters

#### factory

[`CancelablePromiseFactory`](../type-aliases/CancelablePromiseFactory.md)\<`T`\>

A function producing a value or promise, optionally reacting to cancellation
via the provided abort signal.

### Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A stream that emits the produced value and then completes.
