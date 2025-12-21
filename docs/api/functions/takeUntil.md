# Function: takeUntil()

> **takeUntil**\<`T`, `R`\>(`notifier`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/takeUntil.ts:22](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/takeUntil.ts#L22)

Creates a stream operator that emits all values from the source stream until
a value is emitted by a `notifier` stream.

This operator controls the lifespan of a stream based on an external signal.
It consumes and re-emits values from the source until the `notifier` stream
emits its first value. As soon as that happens, the operator completes the
output stream and unsubscribes from both the source and the notifier.

This is useful for automatically stopping an operation when a certain condition
is met, such as waiting for a user to close a dialog or for an animation to complete.

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
should complete.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
