# Function: first()

> **first**\<`T`\>(`predicate?`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/first.ts:22](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/first.ts#L22)

Creates a stream operator that emits only the first element from the source stream
that matches an optional predicate.

This operator is designed to find a specific value and then immediately terminate.
- If a `predicate` function is provided, the operator will emit the first value for which
the predicate returns a truthy value.
- If no predicate is provided, it will simply emit the very first value from the source.

After emitting a single value, the operator completes. If the source stream completes
before a matching value is found, an error is thrown.

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

Throws an error with the message "No elements in sequence" if no matching
value is found before the source stream completes.
