# Function: distinctUntilChanged()

> **distinctUntilChanged**\<`T`\>(`comparator?`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/distinctUntilChanged.ts:17](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/distinctUntilChanged.ts#L17)

Creates a stream operator that emits values from the source stream only if
they are different from the previous value.

This operator filters out consecutive duplicate values, ensuring that the
output stream only contains values that have changed since the last emission.
It's particularly useful for preventing redundant updates in data streams.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### comparator?

(`prev`, `curr`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

An optional function that compares the previous and current values.
It should return `true` if they are considered the same, and `false` otherwise.
If not provided, a strict equality check (`===`) is used.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
