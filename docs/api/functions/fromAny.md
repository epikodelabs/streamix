# Function: fromAny()

> **fromAny**\<`R`\>(`value`): [`Stream`](../type-aliases/Stream.md)\<`R`\>

Defined in: [converters/fromAny.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/converters/fromAny.ts#L21)

Converts various value types into a Stream.

This function normalizes different input types into a consistent Stream interface:
- Streams are passed through as-is
- Promises are awaited and their resolved values are processed
- Arrays have each element emitted individually
- Single values are emitted as-is

## Type Parameters

### R

`R` = `any`

The type of values emitted by the resulting stream.

## Parameters

### value

The input value to convert. Can be:
  - a [\<R\>](../type-aliases/Stream.md)
  - a `Promise<R>` (single value)
  - a `Promise<Array<R>>` (multiple values from array)
  - a plain value `R`
  - an array `Array<R>`

`R` | [`Stream`](../type-aliases/Stream.md)\<`R`\> | `R`[] | `Promise`\<`R` \| `R`[]\>

## Returns

[`Stream`](../type-aliases/Stream.md)\<`R`\>

A [\<R\>](../type-aliases/Stream.md) that emits the normalized values.
