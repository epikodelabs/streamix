# Function: firstValueFrom()

> **firstValueFrom**\<`T`\>(`stream`): `Promise`\<`T`\>

Defined in: [converters/firstValueFrom.ts:24](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/converters/firstValueFrom.ts#L24)

Returns a promise that resolves with the first emitted value from a `Stream`.

This utility function bridges the gap between the stream's push-based system and
JavaScript's standard promise-based asynchronous programming model. It's designed
for scenarios where you only care about the very first value a stream produces,
treating the stream like a single-value asynchronous source.

The function's behavior is as follows:
- If the stream emits a value, the promise resolves with that value.
- If the stream emits an error, the promise rejects with that error.
- If the stream completes without ever emitting a value, the promise rejects with an `Error`.

Once the promise is either resolved or rejected, the subscription to the stream is
automatically terminated, preventing any further resource consumption. This makes it
an efficient way to "query" a stream for a single result.

## Type Parameters

### T

`T` = `any`

The type of the value that the promise will resolve with.

## Parameters

### stream

[`Stream`](../type-aliases/Stream.md)\<`T`\>

The source stream to listen to.

## Returns

`Promise`\<`T`\>

A promise that resolves with the first value from the stream or rejects on error or completion without a value.
