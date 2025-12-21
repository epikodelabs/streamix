# Function: skipUntil()

> **skipUntil**\<`T`, `R`\>(`notifier`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/skipUntil.ts:23](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/skipUntil.ts#L23)

Creates a stream operator that skips all values from the source stream until
a value is emitted by a `notifier` stream.

This operator controls the flow of data based on an external signal. It initially
drops all values from the source stream. It also subscribes to a separate `notifier`
stream. When the notifier emits its first value, the operator's internal state
changes, allowing all subsequent values from the source stream to pass through.

This is useful for delaying the start of a data-intensive process until a specific
condition is met, for example, waiting for a user to click a button or for
an application to finish loading.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

### R

`R` = `T`

## Parameters

### notifier

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`R` \| [`Stream`](../type-aliases/Stream.md)\<`R`\>\>

The stream that, upon its first emission, signals that the operator
should stop skipping values.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
