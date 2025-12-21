# Function: empty()

> **empty**\<`T`\>(): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/EMPTY.ts:23](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/EMPTY.ts#L23)

A singleton instance of an empty stream.

This constant provides a reusable, empty stream that immediately completes
upon subscription without emitting any values. It is useful in stream
compositions as a placeholder or to represent a sequence with no elements.

## Type Parameters

### T

`T` = `any`

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>
