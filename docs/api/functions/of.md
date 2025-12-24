# Function: of()

> **of**\<`T`\>(`value`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [streams/of.ts:15](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/of.ts#L15)

Creates a stream that emits a single value and then completes.

This operator is useful for scenarios where you need to treat a static,
single value as a stream. It immediately yields the provided `value`
and then signals completion, which is a common pattern for creating a
"hot" stream from a predefined value.

## Type Parameters

### T

`T` = `any`

The type of the value to be emitted.

## Parameters

### value

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\>

The single value to emit.

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

A new stream that emits the value and then completes.
