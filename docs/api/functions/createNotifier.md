# Function: createNotifier()

> **createNotifier**(): `object`

Defined in: [primitives/buffer.ts:61](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L61)

Simple condition variable implementation based on Promises.
Used to signal waiting readers when new data arrives or completion/error occurs.

## Returns

### wait()

> **wait**: () => `Promise`\<`void`\>

Returns a Promise that resolves when signal() or signalAll() is called.

#### Returns

`Promise`\<`void`\>

### signal()

> **signal**: () => `undefined` \| `void`

Signals a single waiting reader.

#### Returns

`undefined` \| `void`

### signalAll()

> **signalAll**: () => `void`

Signals all waiting readers.

#### Returns

`void`
