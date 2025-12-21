# Function: throwError()

> **throwError**\<`T`\>(`message`): [`Operator`](../type-aliases/Operator.md)\<`T`, `never`\>

Defined in: [operators/throwError.ts:17](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/throwError.ts#L17)

Creates a stream operator that immediately throws an error with the provided message.

This operator is a source operator that is used to create a stream that immediately
fails. When a consumer requests a value by calling `next()`, the operator
will throw an `Error` with the given `message`, without emitting any values.

This is useful for testing error handling logic in a stream pipeline or for
explicitly modeling a failed asynchronous operation.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream (this is a formality, as no values are emitted).

## Parameters

### message

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`string`\>

The error message to be thrown.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `never`\>

An `Operator` instance that creates a stream which errors upon its first request.
