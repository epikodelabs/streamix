# Function: reduce()

> **reduce**\<`T`, `A`\>(`accumulator`, `seed`): [`Operator`](../type-aliases/Operator.md)\<`T`, `A`\>

Defined in: [operators/reduce.ts:17](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/reduce.ts#L17)

Creates a stream operator that accumulates all values from the source stream
into a single value using a provided accumulator function.

This operator consumes the source lazily and emits intermediate values as phantoms.
It will always emit at least the seed value if the stream is empty.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

### A

`A` = `any`

The type of the accumulated value.

## Parameters

### accumulator

(`acc`, `value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`A`\>

Function combining current accumulated value with a new value.
Can be synchronous or asynchronous.

### seed

`A`

Initial value for the accumulator.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `A`\>

An `Operator` instance usable in a stream's `pipe` method.
