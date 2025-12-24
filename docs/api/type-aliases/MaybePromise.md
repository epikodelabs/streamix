# Type Alias: MaybePromise\<T\>

> **MaybePromise**\<`T`\> = `T` \| `Promise`\<`T`\>

Defined in: [abstractions/operator.ts:13](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/operator.ts#L13)

Represents a value that can either be a synchronous return or a promise that
resolves to the value.

This type is used to support both synchronous and asynchronous callbacks
within stream handlers, providing flexibility without requiring every
handler to be an async function.

## Type Parameters

### T

`T` = `any`

The type of the value returned by the callback.
