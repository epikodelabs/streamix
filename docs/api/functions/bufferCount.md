# Function: bufferCount()

> **bufferCount**\<`T`\>(`bufferSize`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`[]\>

Defined in: [operators/bufferCount.ts:11](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/bufferCount.ts#L11)

Buffers a fixed number of values from the source stream and emits them as arrays,
tracking pending and phantom values in the PipeContext.

## Type Parameters

### T

`T` = `any`

The type of values in the source stream.

## Parameters

### bufferSize

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\> = `Infinity`

The maximum number of values per buffer (default: Infinity).

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`[]\>

An Operator instance for use in a stream's `pipe` method.
