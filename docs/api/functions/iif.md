# Function: iif()

> **iif**\<`T`\>(`condition`, `trueStream`, `falseStream`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/iif.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/iif.ts#L16)

Creates a stream that chooses between two streams based on a condition.

The condition is evaluated lazily when the stream is subscribed to. This allows
for dynamic stream selection based on runtime state.

## Type Parameters

### T

`T` = `any`

The type of the values in the streams.

## Parameters

### condition

() => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

A function that returns a boolean to determine which stream to use. It is called when the iif stream is subscribed to.

### trueStream

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T` \| [`Stream`](../type-aliases/Stream.md)\<`T`\> \| `T`[]\>

The stream to subscribe to if the condition is `true`.

### falseStream

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T` \| [`Stream`](../type-aliases/Stream.md)\<`T`\> \| `T`[]\>

The stream to subscribe to if the condition is `false`.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that emits values from either `trueStream` or `falseStream` based on the condition.
