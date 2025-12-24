# Function: forkJoin()

> **forkJoin**\<`T`, `R`\>(...`sources`): [`Stream`](../type-aliases/Stream.md)\<`T`[]\>

Defined in: [streams/forkJoin.ts:10](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/forkJoin.ts#L10)

Waits for all streams to complete and emits an array of their last values.

## Type Parameters

### T

`T` = `any`

The type of the last values emitted by each stream.

### R

`R` *extends* readonly `unknown`[] = `any`[]

## Parameters

### sources

...\{ \[K in string \| number \| symbol\]: MaybePromise\<R\[K\<K\>\] \| Stream\<R\[K\<K\>\]\> \| R\[K\<K\>\]\[\]\> \}

Streams to join; arrays/iterables are also accepted for backward compatibility.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`[]\>

Stream<T[]>
