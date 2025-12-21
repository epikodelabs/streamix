# Function: catchError()

> **catchError**\<`T`\>(`handler`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/catchError.ts:22](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/catchError.ts#L22)

Creates a stream operator that catches errors from the source stream and handles them.

This operator listens for errors from the upstream source. When the first error is
caught, it invokes a provided `handler` callback and then immediately completes
the stream, preventing the error from propagating further down the pipeline.

- **Error Handling:** The `handler` is executed only for the first error encountered.
- **Completion:** After an error is caught and handled, the operator completes,
terminating the stream's flow.
- **Subsequent Errors:** Any errors after the first will be re-thrown.

This is useful for error-handling strategies where you want to perform a specific
cleanup action and then gracefully terminate the stream.

## Type Parameters

### T

`T` = `any`

The type of the values emitted by the stream.

## Parameters

### handler

(`error`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`void`\>

The function to call when an error is caught. It can return a `void` or a `Promise<void>`.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
