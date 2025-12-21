# Function: loop()

> **loop**\<`T`\>(`initialValue`, `condition`, `iterateFn`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/loop.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/loop.ts#L18)

Creates a stream that emits values in a loop based on a condition and an
iteration function.

This operator is useful for generating a sequence of values until a specific
condition is no longer met. It starts with an `initialValue` and, for each
iteration, it yields the current value and then uses `iterateFn` to
calculate the next value in the sequence.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### initialValue

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\>

The starting value for the loop.

### condition

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

A function that returns `true` to continue the loop and `false` to stop.

### iterateFn

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\>

A function that returns the next value in the sequence.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A stream that emits the generated sequence of values.
