# Type Alias: PipeStreamHookResult

> **PipeStreamHookResult** = `object`

Defined in: [abstractions/hooks.ts:29](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L29)

Result returned from `onPipeStream` runtime hook.

Allows intercepting and replacing parts of the stream pipeline.

## Properties

### source?

> `optional` **source**: `AsyncIterator`\<`any`\>

Defined in: [abstractions/hooks.ts:31](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L31)

Optionally replace the source iterator

***

### operators?

> `optional` **operators**: `any`[]

Defined in: [abstractions/hooks.ts:34](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L34)

Optionally replace or mutate the operator list

***

### final()?

> `optional` **final**: (`iterator`) => `AsyncIterator`\<`any`\>

Defined in: [abstractions/hooks.ts:40](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L40)

Optional final wrapper applied after operators
but before the stream is consumed.

#### Parameters

##### iterator

`AsyncIterator`\<`any`\>

#### Returns

`AsyncIterator`\<`any`\>
