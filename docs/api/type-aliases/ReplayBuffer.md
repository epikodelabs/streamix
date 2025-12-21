# Type Alias: ReplayBuffer\<T\>

> **ReplayBuffer**\<`T`\> = [`CyclicBuffer`](CyclicBuffer.md)\<`T`\> & `object`

Defined in: [primitives/buffer.ts:50](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L50)

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
