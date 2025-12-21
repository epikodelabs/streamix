# Function: withLatestFrom()

> **withLatestFrom**\<`T`, `R`\>(...`streams`): [`Operator`](../type-aliases/Operator.md)\<`T`, \[`T`, `...R[]`\]\>

Defined in: [operators/withLatestFrom.ts:34](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/withLatestFrom.ts#L34)

Creates a stream operator that combines the source stream with the latest values
from other provided streams.

This operator is useful for merging a "trigger" stream with "state" streams.
It waits for a value from the source stream and, when one arrives, it emits a
tuple containing that source value along with the most recently emitted value
from each of the other streams.

The operator is "gated" and will not emit any values until all provided streams
have emitted at least one value.
Inputs may be streams, plain values, arrays, or promises of those shapes; a single
array argument is treated the same as passing values variadically.

## Type Parameters

### T

`T` = `any`

The type of the values in the source stream.

### R

`R` *extends* readonly `unknown`[] = `any`[]

The tuple type of the values from the other streams (e.g., [R1, R2, R3]).

## Parameters

### streams

...\{ \[K in string \| number \| symbol\]: MaybePromise\<R\[K\<K\>\] \| Stream\<R\[K\<K\>\]\> \| R\[K\<K\>\]\[\]\> \}

Streams (or values/arrays/promises) to combine with the source stream.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, \[`T`, `...R[]`\]\>

An `Operator` instance that can be used in a stream's `pipe` method.
The output stream emits tuples of `[T, ...R]`.
