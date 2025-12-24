# Function: throttle()

> **throttle**\<`T`\>(`duration`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/throttle.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/throttle.ts#L16)

Creates a throttle operator that emits the first value immediately, then ignores subsequent
values for the specified duration. If new values arrive during the cooldown, the
last one is emitted after the cooldown expires (trailing emit).

This version tracks pending results and phantoms in PipeContext.

## Type Parameters

### T

`T` = `any`

The type of values emitted by the source and output.

## Parameters

### duration

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

The throttle duration in milliseconds.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An Operator instance that applies throttling to the source stream.
