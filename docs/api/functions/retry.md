# Function: retry()

> **retry**\<`T`\>(`factory`, `maxRetries?`, `delay?`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/retry.ts:20](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/retry.ts#L20)

Creates a stream that subscribes to a source factory and retries on error.

This operator is useful for handling streams that may fail due to
temporary issues, such as network problems. It will attempt to
resubscribe to the source stream up to `maxRetries` times, with an
optional delay between each attempt. If the stream completes successfully
on any attempt, it will emit all of its values and then complete.
If all retry attempts fail, the final error is propagated.

## Type Parameters

### T

`T` = `any`

The type of values emitted by the stream.

## Parameters

### factory

() => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`T` \| [`Stream`](../type-aliases/Stream.md)\<`T`\>\>

A function that returns a new stream instance for each subscription attempt.

### maxRetries?

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\> = `3`

The maximum number of times to retry the stream. A value of 0 means no retries.

### delay?

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\> = `1000`

The time in milliseconds to wait before each retry attempt.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that applies the retry logic.
