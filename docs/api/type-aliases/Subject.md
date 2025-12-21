# Type Alias: Subject\<T\>

> **Subject**\<`T`\> = [`Stream`](Stream.md)\<`T`\> & `object`

Defined in: [subjects/subject.ts:26](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/subjects/subject.ts#L26)

A `Subject` is a special type of `Stream` that can be manually pushed new values.
It acts as both a source of values and a consumer, multicasting to multiple subscribers.
Unlike a standard stream which is "cold" and begins from scratch for each subscriber,
a Subject is "hot" and broadcasts the same values to all of its subscribers.

## Type declaration

### next()

> **next**(`value`): `void`

Pushes the next value to all active subscribers.

#### Parameters

##### value

`T`

The value to emit.

#### Returns

`void`

### complete()

> **complete**(): `void`

Signals that the subject has completed and will emit no more values.
This completion signal is sent to all subscribers.

#### Returns

`void`

### error()

> **error**(`err`): `void`

Signals that the subject has terminated with an error.
The error is sent to all subscribers, and the subject is marked as completed.

#### Parameters

##### err

`any`

The error to emit.

#### Returns

`void`

### completed()

> **completed**(): `boolean`

Checks if the subject has been completed.

#### Returns

`boolean`

`true` if the subject has completed, `false` otherwise.

### snappy

#### Get Signature

> **get** **snappy**(): `undefined` \| `T`

Provides synchronous access to the most recently pushed value.

##### Returns

`undefined` \| `T`

## Type Parameters

### T

`T` = `any`

The type of the values held and emitted by the subject.
