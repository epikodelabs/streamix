# Function: unique()

> **unique**\<`T`, `K`\>(`keySelector?`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/unique.ts:20](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/unique.ts#L20)

Creates a stream operator that emits only distinct values from the source stream.

This operator maintains an internal set of values or keys that it has already emitted.
For each new value from the source, it checks if it has been seen before. If not,
the value is emitted and added to the set; otherwise, it is skipped.

The uniqueness check can be based on the value itself or on a key derived from
the value using a provided `keySelector` function. This makes it ideal for de-duplicating
streams of primitive values or complex objects.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

### K

`K` = `any`

The type of the key used for comparison.

## Parameters

### keySelector?

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`K`\>

An optional function to derive a unique key from each value.
If not provided, the values themselves are used for comparison.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
