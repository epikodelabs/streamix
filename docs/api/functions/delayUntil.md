# Function: delayUntil()

> **delayUntil**\<`T`, `R`\>(`notifier`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/delayUntil.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/delayUntil.ts#L21)

Creates a stream operator that delays the emission of values from the source stream
until a separate `notifier` stream emits at least one value.

This operator acts as a gate. It buffers all values from the source stream
until the `notifier` stream emits its first value. Once the notifier emits,
the operator immediately flushes all buffered values and then passes through
all subsequent values from the source without delay.

If the `notifier` stream completes without ever emitting a value, the buffered 
values are DISCARDED, and the operator simply waits for the source to complete.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

### R

`R` = `T`

## Parameters

### notifier

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`R` \| [`Stream`](../type-aliases/Stream.md)\<`R`\> \| `R`[]\>

The stream that acts as a gatekeeper.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
