# Function: defaultIfEmpty()

> **defaultIfEmpty**\<`T`\>(`defaultValue`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/defaultIfEmpty.ts:15](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/defaultIfEmpty.ts#L15)

Creates a stream operator that emits a default value if the source stream is empty.

This operator monitors the source stream for any emitted values. If the source
stream completes without emitting any values, this operator will emit a single
`defaultValue` and then complete. If the source stream does emit at least one value,
this operator will pass all values through and will not emit the `defaultValue`.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### defaultValue

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\>

The value to emit if the source stream is empty.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
