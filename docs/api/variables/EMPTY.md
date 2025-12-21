# Variable: EMPTY

> `const` **EMPTY**: [`Stream`](../type-aliases/Stream.md)\<`any`\>

Defined in: [streams/EMPTY.ts:51](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/EMPTY.ts#L51)

A singleton instance of an empty stream.

This constant provides a reusable, empty stream that immediately completes
upon subscription without emitting any values. It is useful in stream
compositions as a placeholder or to represent a sequence with no elements.
