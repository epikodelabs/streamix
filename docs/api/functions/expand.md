# Function: expand()

> **expand**\<`T`\>(`project`, `options`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/expand.ts:22](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/expand.ts#L22)

Creates a stream operator that recursively expands each emitted value.

This operator takes each value from the source stream and applies the `project`
function to it, which must return a new stream. It then recursively applies
the same logic to each value emitted by that new stream, effectively
flattening an infinitely deep, asynchronous data structure.

This is particularly useful for traversing graph or tree-like data, such as
file directories or hierarchical API endpoints, where each item might lead
to a new collection of items that also need to be processed.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### project

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`T` \| [`Stream`](../type-aliases/Stream.md)\<`T`\> \| `T`[]\>

A function that takes a value and returns a stream of new values
to be expanded.

### options

[`RecurseOptions`](../type-aliases/RecurseOptions.md) = `{}`

An optional configuration object for the underlying `recurse` operator.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
