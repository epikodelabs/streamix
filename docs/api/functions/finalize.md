# Function: finalize()

> **finalize**\<`T`\>(`callback`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [hooks/finalize.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/hooks/finalize.ts#L16)

Creates a stream operator that invokes a finalizer callback upon stream termination.

This operator is useful for performing cleanup tasks, such as closing resources
or logging, after a stream has completed or encountered an error. The provided
`callback` is guaranteed to be called exactly once, regardless of whether the
stream terminates gracefully or with an error.

## Type Parameters

### T

`T` = `any`

The type of the values emitted by the stream.

## Parameters

### callback

() => `any`

The function to be called when the stream completes or errors.
It can be synchronous or return a Promise.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
