# Function: range()

> **range**(`start`, `count`, `step?`): [`Stream`](../type-aliases/Stream.md)\<`number`\>

Defined in: [streams/range.ts:17](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/range.ts#L17)

Creates a stream that emits a sequence of numbers, starting from `start`,
incrementing by `step`, and emitting a total of `count` values.

This operator is a powerful way to generate a numerical sequence in a
reactive context. It's similar to a standard `for` loop but produces
values as a stream. It's built upon the `loop` operator for its
underlying logic.

## Parameters

### start

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The first number to emit in the sequence.

### count

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The total number of values to emit. Must be a non-negative number.

### step?

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\> = `1`

The amount to increment or decrement the value in each step.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`number`\>

A stream that emits a sequence of numbers.
