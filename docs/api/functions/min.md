# Function: min()

> **min**\<`T`\>(`comparator?`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/min.ts:26](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/min.ts#L26)

Creates a stream operator that emits the minimum value from the source stream.

This is a terminal operator that consumes the source lazily.
It keeps track of the smallest value seen so far and emits phantoms for intermediate values.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### comparator?

(`a`, `b`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

Optional function to compare two values. Returns negative if `a < b`.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance usable in a stream's `pipe` method.
