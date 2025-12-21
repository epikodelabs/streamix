# Function: toArray()

> **toArray**\<`T`\>(): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`[]\>

Defined in: [operators/toArray.ts:10](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/toArray.ts#L10)

Collects all emitted values from the source stream into an array
and emits that array once the source completes, tracking pending state.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`[]\>

An Operator instance for use in a stream's `pipe` method.
