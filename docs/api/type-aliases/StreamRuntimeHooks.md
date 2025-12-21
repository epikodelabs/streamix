# Type Alias: StreamRuntimeHooks

> **StreamRuntimeHooks** = `object`

Defined in: [abstractions/hooks.ts:49](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L49)

Runtime hooks for Streamix internal lifecycle events.

These hooks are intended for tracing, debugging,
profiling, and developer tooling.

## Properties

### onCreateStream()?

> `optional` **onCreateStream**: (`info`) => `void`

Defined in: [abstractions/hooks.ts:56](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L56)

Called when a stream is created.

Useful for registering stream metadata
or initializing tracing structures.

#### Parameters

##### info

###### id

`string`

Generated stream identifier

###### name?

`string`

Optional stream name

#### Returns

`void`

***

### onPipeStream()?

> `optional` **onPipeStream**: (`ctx`) => [`PipeStreamHookResult`](PipeStreamHookResult.md) \| `void`

Defined in: [abstractions/hooks.ts:70](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/hooks.ts#L70)

Called when a stream is piped.

Allows observing or modifying the pipeline,
including source, operators, or final iterator.

#### Parameters

##### ctx

[`PipeStreamHookContext`](PipeStreamHookContext.md)

#### Returns

[`PipeStreamHookResult`](PipeStreamHookResult.md) \| `void`
