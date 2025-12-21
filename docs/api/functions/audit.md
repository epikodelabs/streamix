# Function: audit()

> **audit**\<`T`\>(`duration`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/audit.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/audit.ts#L18)

Creates a stream operator that emits the latest value from the source stream
at most once per specified duration.

Each incoming value is stored as the "latest"; a timer emits that latest value
when the duration elapses. If the source completes before emission, the last
buffered value is flushed before completing.

## Type Parameters

### T

`T` = `any`

The type of the values in the stream.

## Parameters

### duration

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The time in milliseconds (or a promise resolving to it) to wait
before emitting the latest value. The duration is resolved once when the operator starts.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
