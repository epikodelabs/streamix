# Type Alias: CyclicBuffer\<T\>

> **CyclicBuffer**\<`T`\> = `object`

Defined in: [primitives/buffer.ts:24](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L24)

Core interface for a buffer that supports concurrent reading and writing.
It models an asynchronous iterable stream.

## Type Parameters

### T

`T` = `any`

## Methods

### write()

> **write**(`value`): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:26](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L26)

Writes a value to the buffer, making it available for readers.

#### Parameters

##### value

`T`

#### Returns

`Promise`\<`void`\>

***

### error()

> **error**(`err`): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:28](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L28)

Writes an error to the buffer, which will be thrown by readers.

#### Parameters

##### err

`Error`

#### Returns

`Promise`\<`void`\>

***

### read()

> **read**(`readerId`): `Promise`\<`IteratorResult`\<`T`, `void`\>\>

Defined in: [primitives/buffer.ts:30](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L30)

Reads the next available item, waiting if the buffer is empty.

#### Parameters

##### readerId

`number`

#### Returns

`Promise`\<`IteratorResult`\<`T`, `void`\>\>

***

### peek()

> **peek**(`readerId`): `Promise`\<`IteratorResult`\<`T`, `void`\>\>

Defined in: [primitives/buffer.ts:32](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L32)

Peeks at the next available item without consuming it.

#### Parameters

##### readerId

`number`

#### Returns

`Promise`\<`IteratorResult`\<`T`, `void`\>\>

***

### complete()

> **complete**(): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:34](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L34)

Completes the buffer, signaling readers that no more items will arrive.

#### Returns

`Promise`\<`void`\>

***

### attachReader()

> **attachReader**(): `Promise`\<`number`\>

Defined in: [primitives/buffer.ts:36](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L36)

Registers a new reader and returns its unique ID.

#### Returns

`Promise`\<`number`\>

***

### detachReader()

> **detachReader**(`readerId`): `Promise`\<`void`\>

Defined in: [primitives/buffer.ts:38](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L38)

Removes a reader and may trigger buffer pruning/memory cleanup.

#### Parameters

##### readerId

`number`

#### Returns

`Promise`\<`void`\>

***

### completed()

> **completed**(`readerId`): `boolean`

Defined in: [primitives/buffer.ts:40](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L40)

Checks if the buffer has completed or errored for a specific reader.

#### Parameters

##### readerId

`number`

#### Returns

`boolean`
