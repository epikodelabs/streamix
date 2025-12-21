# Function: endWith()

> **endWith**\<`T`\>(`finalValue`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [hooks/endWith.ts:13](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/hooks/endWith.ts#L13)

Creates a stream operator that emits a final, specified value after the source stream has completed.

The operator first consumes all values from the upstream source. Once the source stream signals
its completion (`done`), this operator then emits the `finalValue` and immediately completes.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### finalValue

`T`

The value to be emitted as the last item in the stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
