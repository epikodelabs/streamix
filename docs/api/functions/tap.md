# Function: tap()

> **tap**\<`T`\>(`tapFunction`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/tap.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/tap.ts#L18)

Creates a stream operator that performs a side-effect for each value from the source
stream without modifying the value.

This operator is primarily used for debugging, logging, or other non-intrusive
actions that need to be performed on each value as it passes through the pipeline.
It is completely transparent to the data stream itself, as it does not transform,
filter, or buffer the values. The provided `tapFunction` is executed for each
value before the value is emitted to the next operator.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### tapFunction

(`value`) => `any`

The function to perform the side-effect. It receives the value
from the stream and can be synchronous or asynchronous.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
