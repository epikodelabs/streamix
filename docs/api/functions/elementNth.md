# Function: elementNth()

> **elementNth**\<`T`\>(`indexPattern`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/elementNth.ts:23](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/elementNth.ts#L23)

Creates a stream operator that emits elements from the source stream at dynamic indices specified
by the asynchronous index pattern function.

This operator is a powerful tool for selective data retrieval. It uses an `indexPattern`
function to determine which elements to pull from the source stream. The function is
called repeatedly, with the current iteration count as an argument, and should return the
zero-based index of the next element to emit. The process stops when the function returns `undefined`.

This is useful for tasks such as:
- Sampling a stream at a fixed interval (e.g., every 10th element).
- Picking a specific, non-sequential set of elements.
- Creating a custom, sparse output stream.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

## Parameters

### indexPattern

(`iteration`) => `undefined` \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The function that specifies the indices to emit. It receives the current
iteration count and should return the next index to emit or `undefined` to stop.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
