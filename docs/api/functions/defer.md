# Function: defer()

> **defer**\<`T`\>(`factory`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/defer.ts:17](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/defer.ts#L17)

Creates a stream that defers the creation of an inner stream until it is
subscribed to.

This operator ensures that the `factory` function is called only when
a consumer subscribes to the stream, making it a good choice for
creating "cold" streams. Each new subscription will trigger a new
call to the `factory` and create a fresh stream instance.

## Type Parameters

### T

`T` = `any`

The type of the values in the inner stream.

## Parameters

### factory

() => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`T` \| [`Stream`](../type-aliases/Stream.md)\<`T`\> \| `T`[]\>

A function that returns the stream to be subscribed to.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that defers subscription to the inner stream.
