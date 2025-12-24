# Function: every()

> **every**\<`T`\>(`predicate`): [`Operator`](../type-aliases/Operator.md)\<`T`, `boolean`\>

Defined in: [operators/every.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/every.ts#L21)

Creates a stream operator that tests if all values from the source stream satisfy a predicate.

This operator consumes the source stream and applies the provided `predicate` function
to each value.
- If the `predicate` returns a truthy value for every element until the source stream
completes, the operator emits `true`.
- If the `predicate` returns a falsy value for any element, the operator immediately
emits `false` and then completes, effectively "short-circuiting" the evaluation.

This is a "pull-based" equivalent of `Array.prototype.every` and is useful for validating
data streams. The operator will emit only a single boolean value before it completes.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### predicate

(`value`, `index`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

The function to test each value. It receives the value and its index.
It can be synchronous or asynchronous.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `boolean`\>

An `Operator` instance that can be used in a stream's `pipe` method.
