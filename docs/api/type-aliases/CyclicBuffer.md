# Type Alias: CyclicBuffer\<T\>

> **CyclicBuffer**\<`T`\> = `object`

Defined in: [primitives/buffer.ts:25](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L25)

Core interface for a buffer that supports concurrent reading and writing.
It models an asynchronous iterable stream.

## Type Parameters

### T

`T` = `any`

## Methods

### write()

> **write**(`value`): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:27](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L27)

Writes a value to the buffer, making it available for readers.

#### Parameters

##### value

`T`

#### Returns

`Promise`\<`void`\>

***

### error()

> **error**(`err`): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:29](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L29)

Writes an error to the buffer, which will be thrown by readers.

#### Parameters

##### err

`Error`

#### Returns

`Promise`\<`void`\>

***

### read()

> **read**(`readerId`): `Promise`\<`IteratorResult`\<`T`, `void`\>\>

Defined in: [primitives/buffer.ts:31](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L31)

Reads the next available item, waiting if the buffer is empty.

#### Parameters

##### readerId

`number`

#### Returns

`Promise`\<`IteratorResult`\<`T`, `void`\>\>

***

### peek()

> **peek**(`readerId`): `Promise`\<`IteratorResult`\<`T`, `void`\>\>

Defined in: [primitives/buffer.ts:33](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L33)

Peeks at the next available item without consuming it.

#### Parameters

##### readerId

`number`

#### Returns

`Promise`\<`IteratorResult`\<`T`, `void`\>\>

***

### complete()

> **complete**(): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:35](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L35)

Completes the buffer, signaling readers that no more items will arrive.

#### Returns

`Promise`\<`void`\>

***

### attachReader()

> **attachReader**(): `Promise`\<`number`\>

Defined in: [primitives/buffer.ts:37](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L37)

Registers a new reader and returns its unique ID.

#### Returns

`Promise`\<`number`\>

***

### detachReader()

> **detachReader**(`readerId`): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:39](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L39)

Removes a reader and may trigger buffer pruning/memory cleanup.

#### Parameters

##### readerId

`number`

#### Returns

`Promise`\<`void`\>

***

### completed()

> **completed**(`readerId`): `boolean`

Defined in: [primitives/buffer.ts:41](https://github.com/epikodelabslabs/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L41)

Checks if the buffer has completed or errored for a specific reader.

#### Parameters

##### readerId

`number`

#### Returns

`boolean`
