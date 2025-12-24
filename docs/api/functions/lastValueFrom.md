# Function: lastValueFrom()

> **lastValueFrom**\<`T`\>(`stream`): `Promise`\<`T`\>

Defined in: [converters/lastValueFrom.ts:23](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/converters/lastValueFrom.ts#L23)

Returns a promise that resolves with the last emitted value from a `Stream`.

This function subscribes to the provided stream and buffers the last value
received. The returned promise is only settled once the stream completes or
errors.

- **Successful resolution:** The promise resolves with the last value emitted
by the stream, but only after the stream has completed.
- **Rejection on error:** If the stream emits an error, the promise is rejected with that error.
- **Rejection on no value:** If the stream completes without emitting any values,
the promise is rejected with a specific error message.

The subscription is automatically and immediately unsubscribed upon completion or
on error, ensuring proper resource cleanup.

## Type Parameters

### T

`T` = `any`

The type of the value expected from the stream.

## Parameters

### stream

[`Stream`](../type-aliases/Stream.md)\<`T`\>

The source stream to listen to for the final value.

## Returns

`Promise`\<`T`\>

A promise that resolves with the last value from the stream or rejects on completion without a value or on error.
