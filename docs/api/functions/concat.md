# Function: concat()

> **concat**\<`T`, `R`\>(...`sources`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/concat.ts:19](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/concat.ts#L19)

Creates a stream that subscribes to multiple streams in sequence.

This operator will subscribe to the first stream and yield all of its
values. Once the first stream completes, it will then subscribe to the
second stream, and so on, until all streams have completed. The resulting
stream will complete only after the last source stream has completed.

If any of the source streams errors, the concatenated stream will also error and
stop processing the remaining streams.

## Type Parameters

### T

`T` = `any`

The type of the values in the streams.

### R

`R` *extends* readonly `unknown`[] = `any`[]

## Parameters

### sources

...\{ \[K in string \| number \| symbol\]: MaybePromise\<R\[K\<K\>\] \| Stream\<R\[K\<K\>\]\> \| R\[K\<K\>\]\[\]\> \}

Streams/values (or a promise of an array) to concatenate.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that emits values from all input streams in sequence.
