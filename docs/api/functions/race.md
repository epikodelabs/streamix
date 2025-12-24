# Function: race()

> **race**\<`T`\>(...`streams`): [`Stream`](../type-aliases/Stream.md)\<`T`\[`number`\]\>

Defined in: [streams/race.ts:20](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/race.ts#L20)

Returns a stream that races multiple input streams.
It emits values from the first stream that produces a value,
then cancels all other streams.

This operator is useful for scenarios where you only need the result from the fastest
of several asynchronous operations. For example, fetching data from multiple servers
and only taking the result from the one that responds first.

Once the winning stream completes, the output stream also completes.
If the winning stream emits an error, the output stream will emit that error.

## Type Parameters

### T

`T` *extends* readonly `unknown`[] = `any`[]

A tuple type representing the combined values from the streams.

## Parameters

### streams

...[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\[`number`\] \| [`Stream`](../type-aliases/Stream.md)\<`T`\[`number`\]\> \| `T`\[`number`\][]\>[]

Streams (or a promise of them) to race against each other.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\[`number`\]\>

A new stream that emits values from the first stream to produce a value.
