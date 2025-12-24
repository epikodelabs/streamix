# Function: interval()

> **interval**(`intervalMs`): [`Stream`](../type-aliases/Stream.md)\<`number`\>

Defined in: [streams/interval.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/interval.ts#L16)

Creates a stream that emits incremental numbers starting from 0 at a regular
interval.

This operator is a shorthand for `timer(0, intervalMs)`, useful for
creating a simple, repeating sequence of numbers. The stream emits a new
value every `intervalMs` milliseconds. It is analogous to `setInterval` but
as an asynchronous stream.

## Parameters

### intervalMs

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The time in milliseconds between each emission.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`number`\>

A stream that emits incrementing numbers (0, 1, 2, ...).
