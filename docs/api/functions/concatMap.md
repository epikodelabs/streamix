# Function: concatMap()

> **concatMap**\<`T`, `R`\>(`project`): [`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

Defined in: [operators/concatMap.ts:24](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/concatMap.ts#L24)

Creates a stream operator that maps each value from the source stream to a new
inner stream (or value/array/promise) and flattens all inner streams sequentially.

For each value from the source:
1. The `project` function is called with the value and its index.
2. The returned value is normalized into a stream using [fromAny](fromAny.md).
3. The inner stream is consumed fully before processing the next outer value.

This ensures that all emitted values maintain their original sequential order.

## Type Parameters

### T

`T` = `any`

The type of values in the source stream.

### R

`R` = `T`

The type of values emitted by the inner streams and the output.

## Parameters

### project

(`value`, `index`) => [`Stream`](../type-aliases/Stream.md)\<`R`\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`[]\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`\>

A function that takes a value from the source stream and its index,
and returns either:
  - a [\<R\>](../type-aliases/Stream.md),
  - a [\<R\>](../type-aliases/MaybePromise.md) (value or promise),
  - or an array of `R`.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

An [Operator](../type-aliases/Operator.md) instance that can be used in a stream's `pipe` method.
