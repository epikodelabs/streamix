# Function: startWith()

> **startWith**\<`T`\>(`initialValue`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [hooks/startWith.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/hooks/startWith.ts#L14)

Creates a stream operator that prepends a specified value to the beginning of the stream.

The operator first emits the `initialValue` immediately upon being iterated.
After this initial emission, it begins to pull and emit values from the
source stream as they become available.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### initialValue

`T`

The value to be emitted as the first item in the stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
