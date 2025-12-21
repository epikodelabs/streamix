# Function: max()

> **max**\<`T`\>(`comparator?`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/max.ts:13](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/max.ts#L13)

Creates a stream operator that emits the maximum value from the source stream.

This is a terminal operator that consumes the entire source lazily,
emitting phantoms along the way and finally emitting the maximum value.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### comparator?

(`a`, `b`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

Optional comparison function: positive if `a > b`, negative if `a < b`.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance usable in a stream's `pipe` method.
