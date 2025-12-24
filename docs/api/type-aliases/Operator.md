# Type Alias: Operator\<T, R\>

> **Operator**\<`T`, `R`\> = `object`

Defined in: [abstractions/operator.ts:49](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L49)

A stream operator that transforms a value from an input stream to an output stream.

Operators are the fundamental building blocks for composing stream transformations.
They are functions that take one stream and return another, allowing for a chain of operations.

## Type Parameters

### T

`T` = `any`

The type of the value being consumed by the operator.

### R

`R` = `T`

The type of the value being produced by the operator.

## Properties

### name?

> `optional` **name**: `string`

Defined in: [abstractions/operator.ts:53](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L53)

An optional name for the operator, useful for debugging.

***

### type

> **type**: `"operator"`

Defined in: [abstractions/operator.ts:57](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L57)

A type discriminator to identify this object as an operator.

***

### apply()

> **apply**: (`source`) => `AsyncIterator`\<`R`\>

Defined in: [abstractions/operator.ts:63](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L63)

The core function that defines the operator's transformation logic. It takes an
asynchronous iterator of type `T` and returns a new asynchronous iterator of type `R`.

#### Parameters

##### source

`AsyncIterator`\<`T`\>

The source async iterator to apply the transformation to.

#### Returns

`AsyncIterator`\<`R`\>
