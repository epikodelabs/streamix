# Function: map()

> **map**\<`T`, `R`\>(`transform`): [`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

Defined in: [operators/map.ts:19](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/map.ts#L19)

Creates a stream operator that applies a transformation function to each value
emitted by the source stream.

This operator is a fundamental part of stream processing. It consumes each value
from the source, passes it to the `transform` function, and then emits the result
of that function. This is a one-to-one mapping, meaning the output stream will
have the same number of values as the source stream, but with potentially different
content and/or type.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

### R

`R` = `any`

The type of the values in the output stream.

## Parameters

### transform

(`value`, `index`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`\>

The transformation function to apply to each value. It receives
the value and its index. This function can be synchronous or asynchronous.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

An `Operator` instance that can be used in a stream's `pipe` method.
