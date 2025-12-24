# Function: skip()

> **skip**\<`T`\>(`count`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/skip.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/skip.ts#L14)

Creates a stream operator that skips the first specified number of values from the source stream.

This operator is useful for "fast-forwarding" a stream. It consumes the initial `count` values
from the source stream without emitting them to the output. Once the count is reached,
it begins to pass all subsequent values through unchanged.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### count

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The number of values to skip from the beginning of the stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
