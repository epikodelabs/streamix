# Function: buffer()

> **buffer**\<`T`\>(`period`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`[]\>

Defined in: [operators/buffer.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/buffer.ts#L14)

Buffers values from the source stream and emits them as arrays every `period` milliseconds,
while tracking pending and phantom values in the PipeContext.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### period

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

Time in milliseconds between each buffer flush.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`[]\>

An Operator instance for use in a stream's `pipe` method.
