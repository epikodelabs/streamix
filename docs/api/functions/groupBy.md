# Function: groupBy()

> **groupBy**\<`T`, `K`\>(`keySelector`): [`Operator`](../type-aliases/Operator.md)\<`T`, [`GroupItem`](../type-aliases/GroupItem.md)\<`T`, `K`\>\>

Defined in: [operators/groupBy.ts:31](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/groupBy.ts#L31)

Creates a stream operator that groups values from the source stream by a computed key.

This operator is a projection operator that transforms a stream of values into a
stream of `GroupItem` objects. For each value from the source, it applies the
`keySelector` function to determine a key and then emits an object containing both
the original value and the computed key.

This operator is the first step in a typical grouping pipeline. The resulting stream
of `GroupItem` objects can then be processed further by other operators (e.g., `scan`
or `reduce`) to perform a true grouping into collections.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

### K

`K` = `any`

The type of the key computed by `keySelector`.

## Parameters

### keySelector

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`K`\>

A function that takes a value from the source stream and returns
a key. This function can be synchronous or asynchronous.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, [`GroupItem`](../type-aliases/GroupItem.md)\<`T`, `K`\>\>

An `Operator` instance that can be used in a stream's `pipe` method.
