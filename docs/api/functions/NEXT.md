# Function: NEXT()

> **NEXT**\<`R`\>(`value`): `object`

Defined in: [abstractions/operator.ts:38](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L38)

Factory function to create a normal stream result.

## Type Parameters

### R

`R` = `any`

The type of the emitted value.

## Parameters

### value

`R`

The value to emit downstream.

## Returns

`object`

A `IteratorResult<R>` object with `{ done: false, value }`.

### done

> `readonly` **done**: `false`

### value

> `readonly` **value**: `R`
