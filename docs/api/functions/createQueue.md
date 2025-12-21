# Function: createQueue()

> **createQueue**(): `object`

Defined in: [primitives/queue.ts:12](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/queue.ts#L12)

Creates an asynchronous queue that processes operations sequentially.
Operations are guaranteed to run in the order they are enqueued, one after another.
This is useful for preventing race conditions and ensuring that dependent
asynchronous tasks are executed in a specific order.

## Returns

`object`

An object representing the queue.

### enqueue()

> **enqueue**: (`operation`) => `Promise`\<`any`\>

#### Parameters

##### operation

() => `Promise`\<`any`\>

#### Returns

`Promise`\<`any`\>

### pending

#### Get Signature

> **get** **pending**(): `number`

##### Returns

`number`

### isEmpty

#### Get Signature

> **get** **isEmpty**(): `boolean`

##### Returns

`boolean`
