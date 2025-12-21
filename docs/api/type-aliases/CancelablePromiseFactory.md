# Type Alias: CancelablePromiseFactory()\<T\>

> **CancelablePromiseFactory**\<`T`\> = (`signal`) => [`MaybePromise`](MaybePromise.md)\<`T`\>

Defined in: [streams/fromPromise.ts:12](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/fromPromise.ts#L12)

Factory for producing a value or promise that supports cooperative cancellation.

The provided [AbortSignal](#) will be aborted when the resulting stream
is unsubscribed or otherwise terminated, allowing the underlying asynchronous
work to stop early if it supports abort signals (e.g. `fetch`).

## Type Parameters

### T

`T`

## Parameters

### signal

[`AbortSignal`](#)

## Returns

[`MaybePromise`](MaybePromise.md)\<`T`\>
