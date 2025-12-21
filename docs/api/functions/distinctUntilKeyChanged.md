# Function: distinctUntilKeyChanged()

> **distinctUntilKeyChanged**\<`T`, `K`\>(`key`, `comparator?`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/distinctUntilKeyChanged.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/distinctUntilKeyChanged.ts#L18)

Creates a stream operator that filters out consecutive values from the source
stream if a specified key's value has not changed.

This operator is a specialized version of `distinctUntilChanged`. It is designed
to work with streams of objects and checks for uniqueness based on the value
of a single property (`key`).

## Type Parameters

### T

`T` *extends* `object` = `any`

The type of the objects in the stream. Must extend `object`.

### K

`K` *extends* `string` \| `number` \| `symbol` = keyof `T`

## Parameters

### key

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`K`\>

The name of the property to check for changes.

### comparator?

(`prev`, `curr`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

An optional function to compare the previous and current values of the `key`.
It should return `true` if the values are considered the same. If not provided,
strict inequality (`!==`) is used.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
