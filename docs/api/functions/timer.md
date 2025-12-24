# Function: timer()

> **timer**(`delayMs?`, `intervalMs?`): [`Stream`](../type-aliases/Stream.md)\<`number`\>

Defined in: [streams/timer.ts:15](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/timer.ts#L15)

Creates a timer stream that emits numbers starting from 0.

This stream is useful for scheduling events or generating periodic data.
It is analogous to `setInterval` but as an asynchronous stream.

## Parameters

### delayMs?

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\> = `0`

The time in milliseconds to wait before emitting the first value (0).
If 0, the first value is emitted immediately (in the next microtask).

### intervalMs?

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The time in milliseconds between subsequent emissions.
If not provided, it defaults to `delayMs`.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`number`\>

A stream that emits incrementing numbers (0, 1, 2, ...).
