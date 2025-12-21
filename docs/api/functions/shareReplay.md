# Function: shareReplay()

> **shareReplay**\<`T`\>(`bufferSize`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/shareReplay.ts:23](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/shareReplay.ts#L23)

Creates a stream operator that shares a single subscription to the source stream
and replays a specified number of past values to new subscribers.

This operator multicasts the source stream, ensuring that multiple downstream
consumers can receive values from a single source connection. It uses an internal
`ReplaySubject` to cache the most recent values. When a new consumer subscribes,
it immediately receives these cached values before receiving new ones.

This is useful for:
- Preventing redundant execution of a source stream (e.g., a network request).
- Providing a "state history" to late subscribers.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### bufferSize

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\> = `Infinity`

The number of last values to replay to new subscribers. Defaults to `Infinity`.
                  Can be a Promise that resolves to a number.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
