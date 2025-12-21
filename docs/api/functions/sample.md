# Function: sample()

> **sample**\<`T`\>(`period`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/sample.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/sample.ts#L16)

Creates a stream operator that emits the most recent value from the source stream
at a fixed periodic interval while tracking pending and phantom states.

Values that arrive faster than the period are considered phantoms if skipped,
and pending results are tracked in PipeContext until resolved or emitted.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### period

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The time in milliseconds between each emission.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An Operator instance for use in a stream's `pipe` method.
