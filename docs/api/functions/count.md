# Function: count()

> **count**\<`T`\>(): [`Operator`](../type-aliases/Operator.md)\<`T`, `number`\>

Defined in: [operators/count.ts:13](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/count.ts#L13)

Creates a stream operator that counts the number of items emitted by the source stream.

This operator consumes all values from the source stream without emitting anything.
Once the source stream completes, it emits a single value, which is the total
number of items that were in the source stream. It then completes.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `number`\>

An `Operator` instance that can be used in a stream's `pipe` method.
