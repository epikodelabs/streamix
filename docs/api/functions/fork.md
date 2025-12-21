# Function: fork()

> **fork**\<`T`, `R`\>(...`options`): [`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

Defined in: [operators/fork.ts:59](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/fork.ts#L59)

Creates a stream operator that routes each source value through a specific handler
based on matching predicates defined in the provided `ForkOption`s.

For each value from the source stream:
1. Iterates over the `options` array.
2. Executes the `on` predicate for each option until one returns `true`.
3. Calls the corresponding `handler` for the first matching option.
4. Flattens the result (stream, value, promise, or array) sequentially into the output stream.

If no predicate matches a value, an error is thrown.

This operator allows conditional branching in streams based on the content of each item.

## Type Parameters

### T

`T` = `any`

The type of values in the source stream.

### R

`R` = `any`

The type of values emitted by the output stream.

## Parameters

### options

...[`MaybePromise`](../type-aliases/MaybePromise.md)\<[`ForkOption`](../interfaces/ForkOption.md)\<`T`, `R`\>\>[]

[ForkOption](../interfaces/ForkOption.md) objects defining predicates and handlers.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

An [Operator](../type-aliases/Operator.md) instance suitable for use in a stream's `pipe` method.

## Throws

If a source value does not match any predicate.
