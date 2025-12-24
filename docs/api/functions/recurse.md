# Function: recurse()

> **recurse**\<`T`\>(`condition`, `project`, `options`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/recurse.ts:40](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/recurse.ts#L40)

Creates a stream operator that recursively processes values from a source stream.

This operator is designed for traversing tree-like or hierarchical data structures.
For each value from the source, it checks if it meets a `condition`. If it does,
it applies a `project` function to get a new "inner" stream of children. These
children are then added to an internal queue and processed in the same recursive manner.

The operator supports both depth-first and breadth-first traversal strategies and
can be configured with a maximum recursion depth to prevent runaway processing.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### condition

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

A function that returns a boolean indicating whether to recurse on a value.

### project

(`value`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`T` \| [`Stream`](../type-aliases/Stream.md)\<`T`\> \| `T`[]\>

A function that takes a value and returns a stream of new values to be
recursively processed.

### options

[`RecurseOptions`](../type-aliases/RecurseOptions.md) = `{}`

An optional configuration object for traversal behavior.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
