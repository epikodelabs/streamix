# Type Alias: Receiver\<T\>

> **Receiver**\<`T`\> = `object`

Defined in: [abstractions/receiver.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/receiver.ts#L14)

Defines a receiver interface for handling a stream's lifecycle events.

A receiver is an object that can be passed to a stream's `subscribe` method
to handle the three primary events in a stream's lifecycle: `next` for
new values, `error` for stream errors, and `complete` when the stream has finished.

All properties are optional, allowing you to subscribe only to the events you care about.

## Type Parameters

### T

`T` = `any`

The type of the value handled by the receiver's `next` method.

## Properties

### next()?

> `optional` **next**: (`value`) => [`MaybePromise`](MaybePromise.md)

Defined in: [abstractions/receiver.ts:19](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/receiver.ts#L19)

A function called for each new value emitted by the stream.

#### Parameters

##### value

`T`

The value emitted by the stream.

#### Returns

[`MaybePromise`](MaybePromise.md)

***

### error()?

> `optional` **error**: (`err`) => [`MaybePromise`](MaybePromise.md)

Defined in: [abstractions/receiver.ts:24](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/receiver.ts#L24)

A function called if the stream encounters an error.

#### Parameters

##### err

`Error`

The error that occurred.

#### Returns

[`MaybePromise`](MaybePromise.md)

***

### complete()?

> `optional` **complete**: () => [`MaybePromise`](MaybePromise.md)

Defined in: [abstractions/receiver.ts:28](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/receiver.ts#L28)

A function called when the stream has completed successfully and will emit no more values.

#### Returns

[`MaybePromise`](MaybePromise.md)
