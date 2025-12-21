# Function: filter()

> **filter**\<`T`\>(`predicateOrValue`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/filter.ts:19](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/filter.ts#L19)

Creates a stream operator that filters values emitted by the source stream.

This operator provides flexible filtering capabilities. It processes each value
from the source stream and passes it through to the output stream only if it meets
a specific criterion.

The filtering can be configured in one of three ways:
- A **predicate function**: A function that returns `true` for values to be included.
- A **single value**: Only values that are strictly equal (`===`) to this value are included.
- An **array of values**: Only values that are present in this array are included.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### predicateOrValue

The filtering criterion. Can be a predicate function, a single value, or an array of values.

`T` | (`value`, `index`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\> | `T`[]

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
