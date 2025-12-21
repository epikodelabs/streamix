# Function: combineLatest()

> **combineLatest**\<`T`\>(...`sources`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/combineLatest.ts:17](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/combineLatest.ts#L17)

Combines multiple streams and emits a tuple containing the latest values
from each stream whenever any of the source streams emits a new value.

This operator is useful for scenarios where you need to react to changes
in multiple independent data sources simultaneously. The output stream
will not emit a value until all source streams have emitted at least one
value. The output stream completes when all source streams have completed.

## Type Parameters

### T

`T` *extends* `unknown`[] = `any`[]

A tuple type representing the combined values from the streams.

## Parameters

### sources

...[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\[`number`\] \| [`Stream`](../type-aliases/Stream.md)\<`T`\[`number`\]\> \| `T`\[`number`\][]\>[]

Streams/values to combine.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that emits a tuple of the latest values from all source streams.
