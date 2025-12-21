# Function: select()

> **select**\<`T`\>(`indexIterator`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/select.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/select.ts#L18)

Creates a stream operator that emits only the values at the specified indices from a source stream.

This operator takes an `indexIterator` (which can be a synchronous or asynchronous iterator
of numbers) and uses it to determine which values from the source stream should be emitted.
It acts as a positional filter: each source value is inspected once, and if its zero-based
index matches the next index yielded by `indexIterator`, that value is emitted. No buffering
of past values occurs. If the iterator completes, the operator completes regardless of
remaining source values.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### indexIterator

An iterator or async iterator that provides the zero-based indices
of the elements to be emitted.

`AsyncIterator`\<`number`, `any`, `undefined`\> | `Iterator`\<`number`, `any`, `undefined`\>

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
