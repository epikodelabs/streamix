# Function: zip()

> **zip**\<`T`\>(...`sources`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/zip.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/zip.ts#L16)

Combines multiple streams by emitting an array of values (a tuple),
only when all streams have a value ready (one-by-one, synchronized).

It waits for the next value from all streams to form the next tuple.
The stream completes when any of the input streams complete.
Errors from any stream propagate immediately.

## Type Parameters

### T

`T` *extends* readonly `unknown`[] = `any`[]

A tuple type representing the combined values from the streams.

## Parameters

### sources

...[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\[`number`\] \| [`Stream`](../type-aliases/Stream.md)\<`T`\[`number`\]\> \| `T`\[`number`\][]\>[]

Streams to combine.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that emits a synchronized tuple of values.
