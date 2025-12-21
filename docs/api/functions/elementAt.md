# Function: elementAt()

> **elementAt**\<`T`\>(`targetIndex`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/elementAt.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/elementAt.ts#L18)

Creates a stream operator that emits only the single value at the specified zero-based index
from the source stream.

This operator consumes the source stream until it reaches the `targetIndex`. It then
emits the value at that position and immediately completes, effectively ignoring all
subsequent values. If the source stream completes before reaching the `targetIndex`,
the output stream will also complete without emitting any value.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### targetIndex

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The zero-based index of the element to retrieve. Must be a non-negative number.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.

## Throws

Throws an error if `targetIndex` is a negative number.
