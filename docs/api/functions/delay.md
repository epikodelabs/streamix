# Function: delay()

> **delay**\<`T`\>(`ms`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/delay.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/delay.ts#L16)

Creates a stream operator that delays the emission of each value from the source stream
while tracking pending and phantom states.

Each value received from the source is added to `context.pendingResults` and is only
resolved once the delay has elapsed and the value is emitted downstream.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### ms

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The time in milliseconds to delay each value.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An Operator instance for use in a stream's `pipe` method.
