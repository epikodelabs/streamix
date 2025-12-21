# Function: switchMap()

> **switchMap**\<`T`, `R`\>(`project`): [`Operator`](../type-aliases/Operator.md)\<`T`, `R`\>

Defined in: [operators/switchMap.ts:27](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/switchMap.ts#L27)

Creates a stream operator that maps each value from the source stream to a new inner stream
and "switches" to emitting values from the most recent inner stream, canceling the previous one.

For each value from the source:
1. The `project` function is called with the value and its index.
2. The returned value is normalized into a stream using [fromAny](fromAny.md).
3. The operator subscribes to the new inner stream and immediately cancels any previous active inner stream.
4. Only values from the latest inner stream are emitted.

This operator is useful for scenarios such as:
- Type-ahead search where only the latest query results are relevant.
- Handling user events where new events invalidate previous operations.

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

An [Operator](../type-aliases/Operator.md) instance suitable for use in a stream's `pipe` method.
