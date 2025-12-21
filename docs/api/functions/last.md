# Function: last()

> **last**\<`T`\>(`predicate?`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/last.ts:19](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/last.ts#L19)

Creates a stream operator that emits only the last value from the source stream
that matches an optional predicate.

This operator must consume the entire source stream to find the last matching
value. It caches the last value that satisfies the `predicate` (or the last
value of the stream if no predicate is provided) and emits it only when the
source stream completes.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### predicate?

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

An optional function to test each value. It receives the value
and should return `true` to indicate a match.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.

## Throws

Throws an error with the message "No elements in sequence" if no
matching value is found before the source stream completes.
