# Function: createOperator()

> **createOperator**\<`T`, `R`\>(`name`, `transformFn`): [`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

Defined in: [abstractions/operator.ts:78](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L78)

Creates a reusable stream operator.

This factory function simplifies the creation of operators by bundling a name and a
transformation function into a single `Operator` object.

## Type Parameters

### T

`T` = `any`

The type of the value the operator will consume.

### R

`R` = `T`

The type of the value the operator will produce.

## Parameters

### name

`string`

The name of the operator, for identification and debugging.

### transformFn

(`source`) => `AsyncIterator`\<`R`\>

The transformation function that defines the operator's logic.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

A new `Operator` object with the specified name and transformation function.
