# Function: debounce()

> **debounce**\<`T`\>(`duration`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/debounce.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/debounce.ts#L16)

Creates a stream operator that emits the most recent value from the source stream
only after a specified duration has passed without another new value.

This version tracks pending results in the PipeContext and marks
superseded values as phantoms.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### duration

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The debounce duration in milliseconds.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An Operator instance for use in a stream pipeline.
