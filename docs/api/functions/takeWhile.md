# Function: takeWhile()

> **takeWhile**\<`T`\>(`predicate`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/takeWhile.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/takeWhile.ts#L21)

Creates a stream operator that emits values from the source stream as long as
a predicate returns true.

This operator is a conditional limiter. It consumes values from the source stream
and applies the `predicate` function to each. As long as the predicate returns `true`,
the value is passed through to the output stream. The first time the predicate returns
a falsy value, the operator stops emitting and immediately completes the output stream.
The value that caused the predicate to fail is not emitted.

This is useful for taking a contiguous block of data from a stream that meets a certain
condition, such as processing user input until an invalid entry is made.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### predicate

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

The function to test each value. `true` means to continue emitting,
and `false` means to stop and complete. It can be synchronous or asynchronous.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
