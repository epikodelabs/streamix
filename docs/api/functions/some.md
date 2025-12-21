# Function: some()

> **some**\<`T`\>(`predicate`): [`Operator`](../type-aliases/Operator.md)\<`T`, `boolean`\>

Defined in: [operators/some.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/some.ts#L21)

Creates a stream operator that tests if at least one value from the source stream satisfies a predicate.

This operator consumes the source stream and applies the provided `predicate` function
to each value.
- If the `predicate` returns a truthy value for any element, the operator immediately
emits `true` and then completes, effectively "short-circuiting" the evaluation.
- If the source stream completes without the `predicate` ever returning a truthy value,
the operator emits `false`.

This is a "pull-based" equivalent of `Array.prototype.some` and is useful for validating
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
