# Interface: ForkOption\<T, R\>

Defined in: [operators/fork.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/fork.ts#L14)

Represents a conditional branch for the `fork` operator.

Each `ForkOption` defines:
1. A predicate function `on` to test source values.
2. A handler function `handler` that produces a stream (or value/array/promise) when the predicate matches.

## Type Parameters

### T

`T` = `any`

The type of values in the source stream.

### R

`R` = `any`

The type of values emitted by the handler and output stream.

## Properties

### on()

> **on**: (`value`, `index`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

Defined in: [operators/fork.ts:22](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/fork.ts#L22)

Predicate function to determine if this option should handle a value.

#### Parameters

##### value

`T`

The value from the source stream.

##### index

`number`

The zero-based index of the value in the source stream.

#### Returns

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`boolean`\>

A boolean or a `Promise<boolean>` indicating whether this option matches.

***

### handler()

> **handler**: (`value`) => [`Stream`](../type-aliases/Stream.md)\<`R`\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`[]\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`\>

Defined in: [operators/fork.ts:35](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/fork.ts#L35)

Handler function called for values that match the predicate.

Can return:
- a [\<R\>](../type-aliases/Stream.md)
- a [\<R\>](../type-aliases/MaybePromise.md) (value or promise)
- an array of `R`

#### Parameters

##### value

`T`

The source value that matched the predicate.

#### Returns

[`Stream`](../type-aliases/Stream.md)\<`R`\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`[]\> \| [`MaybePromise`](../type-aliases/MaybePromise.md)\<`R`\>

A stream, value, promise, or array to be flattened and emitted.
