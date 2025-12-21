# Function: ignoreElements()

> **ignoreElements**\<`T`\>(): [`Operator`](../type-aliases/Operator.md)\<`T`, `never`\>

Defined in: [operators/ignoreElements.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/ignoreElements.ts#L14)

Creates a stream operator that ignores all values emitted by the source stream.

This operator consumes the source stream but does not emit any values. It only
forwards the completion or error signal from the source stream. This is useful
when you only care about the "end" of an operation, not the intermediate results.
For example, waiting for a stream of side effects to complete before continuing.

## Type Parameters

### T

`T`

The type of the values in the source stream (which are ignored).

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `never`\>

An `Operator` instance that can be used in a stream's `pipe` method.
