# Function: scan()

> **scan**\<`T`, `R`\>(`accumulator`, `seed`): [`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

Defined in: [operators/scan.ts:20](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/scan.ts#L20)

Creates a stream operator that accumulates values from the source stream,
emitting each intermediate accumulated result.

This operator is stateful and is ideal for scenarios where you need to maintain
a running total or build a state object over the life of a stream. It takes a
`seed` value and an `accumulator` function. For each value from the source,
it applies the accumulator and emits the new result immediately.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

### R

`R` = `any`

The type of the accumulated value and the output stream.

## Parameters

### accumulator

(`acc`, `value`, `index`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`\>

The function that combines the current accumulated value
with the new value from the source. This function can be synchronous or asynchronous.

### seed

`R`

The initial value for the accumulator.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

An `Operator` instance that can be used in a stream's `pipe` method.
