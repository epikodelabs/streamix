# Function: take()

> **take**\<`T`\>(`count`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/take.ts:17](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/take.ts#L17)

Creates a stream operator that emits only the first `count` values from the source stream
and then completes.

This operator is a powerful tool for controlling the length of a stream. It consumes values
from the source one by one, and as long as the total number of values emitted is less than
`count`, it passes them through to the output. Once the count is reached, it stops
processing the source and signals completion to its downstream consumers. This is especially
useful for managing finite segments of large or infinite streams.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### count

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The maximum number of values to take from the beginning of the stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
