# Type Alias: StrictReceiver\<T\>

> **StrictReceiver**\<`T`\> = `Required`\<[`Receiver`](Receiver.md)\<`T`\>\> & `object`

Defined in: [abstractions/receiver.ts:42](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/receiver.ts#L42)

A fully defined, state-aware receiver with guaranteed lifecycle handlers.

This type extends the `Receiver` interface by making all handler methods
(`next`, `error`, and `complete`) required. It also includes a `completed`
property to track the receiver's state, preventing it from processing
new events after it has completed. This is an internal type used to ensure
robust handling of all stream events.

## Type declaration

### completed

> `readonly` **completed**: `boolean`

## Type Parameters

### T

`T` = `any`

The type of the value handled by the receiver.
