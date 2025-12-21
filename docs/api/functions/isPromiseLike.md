# Function: isPromiseLike()

> **isPromiseLike**\<`T`\>(`value`): `value is Promise<T>`

Defined in: [abstractions/operator.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L21)

Type guard that checks whether a value behaves like a promise.

We avoid relying on `instanceof Promise` so that promise-like values from
different realms or custom thenables are still treated correctly.

## Type Parameters

### T

`T` = `any`

## Parameters

### value

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\>

## Returns

`value is Promise<T>`
