# Type Alias: PipeStreamHookContext

> **PipeStreamHookContext** = `object`

Defined in: [abstractions/hooks.ts:7](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L7)

Context object passed to `onPipeStream` runtime hook.

Describes the stream being piped, its subscription,
the original source iterator, and the operator chain.

## Properties

### streamId

> **streamId**: `string`

Defined in: [abstractions/hooks.ts:9](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L9)

Unique identifier of the stream instance

***

### streamName?

> `optional` **streamName**: `string`

Defined in: [abstractions/hooks.ts:12](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L12)

Optional human-readable stream name

***

### subscriptionId

> **subscriptionId**: `string`

Defined in: [abstractions/hooks.ts:15](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L15)

Unique identifier of the subscription

***

### source

> **source**: `AsyncIterator`\<`any`\>

Defined in: [abstractions/hooks.ts:18](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L18)

Source async iterator before operators are applied

***

### operators

> **operators**: `any`[]

Defined in: [abstractions/hooks.ts:21](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L21)

List of operators applied to the stream
