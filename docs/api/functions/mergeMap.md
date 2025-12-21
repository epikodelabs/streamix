# Function: mergeMap()

> **mergeMap**\<`T`, `R`\>(`project`): [`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

Defined in: [operators/mergeMap.ts:27](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/mergeMap.ts#L27)

Creates a stream operator that maps each value from the source stream to an "inner" stream
and merges all inner streams concurrently into a single output stream.

For each value from the source stream:
1. The `project` function is called with the value and its index.
2. The returned value is normalized into a stream using [fromAny](fromAny.md).
3. The inner stream is consumed concurrently with all other active inner streams.
4. Emitted values from all inner streams are interleaved into the output stream
   in the order they are produced, without waiting for other inner streams to complete.

This operator is useful for performing parallel asynchronous operations while
preserving all emitted values in a merged output.

## Type Parameters

### T

`T` = `any`

The type of values in the source stream.

### R

`R` = `any`

The type of values emitted by the inner and output streams.

## Parameters

### project

(`value`, `index`) => [`Stream`](../type-aliases/Stream.md)\<`R`\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`[]\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`\>

A function that maps a source value and its index to either:
  - a [\<R\>](../type-aliases/Stream.md),
  - a [\<R\>](../type-aliases/MaybePromise.md) (value or promise),
  - or an array of `R`.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

An [Operator](../type-aliases/Operator.md) instance that can be used in a stream's `pipe` method.
