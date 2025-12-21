# Function: pipeSourceThrough()

> **pipeSourceThrough**\<`TIn`, `Ops`\>(`source`, `operators`): [`Stream`](../type-aliases/Stream.md)\<`any`\>

Defined in: [abstractions/stream.ts:437](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/stream.ts#L437)

Pipes a source stream through a chain of operators,
producing a derived unicast stream.

## Type Parameters

### TIn

`TIn`

### Ops

`Ops` *extends* [`Operator`](../type-aliases/Operator.md)\<`any`, `any`\>[]

## Parameters

### source

[`Stream`](../type-aliases/Stream.md)\<`TIn`\>

Source stream

### operators

\[`...Ops[]`\]

Operators applied to the source

## Returns

[`Stream`](../type-aliases/Stream.md)\<`any`\>

Derived unicast Stream
