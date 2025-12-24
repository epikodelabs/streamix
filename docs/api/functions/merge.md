# Function: merge()

> **merge**\<`T`, `R`\>(...`sources`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/merge.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/merge.ts#L18)

Merges multiple source streams into a single stream, emitting values as they arrive from any source.

This is useful for combining data from multiple independent sources into a single,
unified stream of events. Unlike `zip`, it does not wait for a value from every
stream before emitting; it emits values on a first-come, first-served basis.

The merged stream completes only after all source streams have completed. If any source stream
errors, the merged stream immediately errors.

## Type Parameters

### T

`T` = `any`

The type of the values in the streams.

### R

`R` *extends* readonly `unknown`[] = `any`[]

## Parameters

### sources

...\{ \[K in string \| number \| symbol\]: MaybePromise\<R\[K\<K\>\] \| Stream\<R\[K\<K\>\]\> \| R\[K\<K\>\]\[\]\> \}

Streams/values (or promise of array) to merge.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that emits values from all input streams.
