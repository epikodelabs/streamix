# Type Alias: ReplayBuffer\<T\>

> **ReplayBuffer**\<`T`\> = [`CyclicBuffer`](CyclicBuffer.md)\<`T`\> & `object`

Defined in: [primitives/buffer.ts:51](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L51)

Extends CyclicBuffer for "Replay" behavior, providing access to the history.

## Type declaration

### buffer

#### Get Signature

> **get** **buffer**(): `T`[]

Gets an array containing all currently buffered values (the replay history).

##### Returns

`T`[]

## Type Parameters

### T

`T` = `any`
