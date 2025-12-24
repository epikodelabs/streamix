# Function: from()

> **from**\<`T`\>(`source`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/from.ts:15](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/from.ts#L15)

Creates a stream from an asynchronous or synchronous iterable.

This operator is a powerful way to convert any source that can be iterated
over (such as arrays, strings, `Map`, `Set`, `AsyncGenerator`, etc.) into
a reactive stream. The stream will emit each value from the source in order
before completing.

## Type Parameters

### T

`T` = `any`

The type of the values in the iterable.

## Parameters

### source

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`AsyncIterable`\<`T`\> \| `Iterable`\<`T`\>\>

The iterable source to convert into a stream.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that emits each value from the source.
