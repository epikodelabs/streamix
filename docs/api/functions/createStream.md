# Function: createStream()

> **createStream**\<`T`\>(`name`, `generatorFn`): [`Stream`](../type-aliases/Stream.md)\<`T`\>

Defined in: [abstractions/stream.ts:341](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/stream.ts#L341)

Creates a multicast stream backed by a shared async generator.

## Type Parameters

### T

`T`

## Parameters

### name

`string`

Stream name (debugging / tooling)

### generatorFn

(`signal`) => `AsyncGenerator`\<`T`, `void`, `unknown`\>

Factory producing an async generator

## Returns

[`Stream`](../type-aliases/Stream.md)\<`T`\>

Multicast Stream instance
