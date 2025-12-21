# Function: slidingPair()

> **slidingPair**\<`T`\>(): [`Operator`](../type-aliases/Operator.md)\<`T`, \[`undefined` \| `T`, `T`\]\>

Defined in: [operators/slidingPair.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/slidingPair.ts#L18)

Creates a stream operator that emits pairs of values from the source stream,
where each pair consists of the previous and the current value.

This operator is a powerful tool for comparing consecutive values in a stream.
It maintains an internal state to remember the last value it received. For
each new value, it creates a tuple of `[previousValue, currentValue]` and
emits it to the output stream.

The very first value emitted will have `undefined` as its "previous" value.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, \[`undefined` \| `T`, `T`\]\>

An `Operator` instance that can be used in a stream's `pipe` method,
emitting tuples of `[T | undefined, T]`.
