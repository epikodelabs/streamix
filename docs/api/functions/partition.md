# Function: partition()

> **partition**\<`T`\>(`predicate`): [`Operator`](../type-aliases/Operator.md)\<`T`, [`GroupItem`](../type-aliases/GroupItem.md)\<`T`, `"true"` \| `"false"`\>\>

Defined in: [operators/partition.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/partition.ts#L21)

Creates a stream operator that partitions the source stream into two groups based on a predicate.

This operator is a specialized form of `groupBy`. For each value from the source stream,
it applies the provided `predicate` function. It then emits a new object, a `GroupItem`,
containing the original value and a key of `"true"` or `"false"`, indicating whether the
value satisfied the predicate.

This operator does not create two physical streams, but rather tags each item with its
group membership, allowing for subsequent conditional routing or processing.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### predicate

(`value`, `index`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

A function that takes a value and its index and returns a boolean or
`Promise<boolean>`. `true` for one group, `false` for the other.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, [`GroupItem`](../type-aliases/GroupItem.md)\<`T`, `"true"` \| `"false"`\>\>

An `Operator` instance that can be used in a stream's `pipe` method,
emitting objects of type `GroupItem<T, "true" | "false">`.
