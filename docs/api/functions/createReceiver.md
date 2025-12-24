# Function: createReceiver()

> **createReceiver**\<`T`\>(`callbackOrReceiver?`): [`StrictReceiver`](../type-aliases/StrictReceiver.md)\<`T`\>

Defined in: [abstractions/receiver.ts:62](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/receiver.ts#L62)

Normalizes a receiver input (a function or an object) into a strict,
fully-defined receiver.

This factory function ensures that a consistent `StrictReceiver` object is
always returned, regardless of the input. It wraps the provided handlers
with logic that ensures events are not processed after completion and that
unhandled errors are logged.

If the input is a function, it is treated as the `next` handler. If it's an
object, its `next`, `error`, and `complete` properties are used. If no input
is provided, a receiver with no-op handlers is created.

## Type Parameters

### T

`T` = `any`

The type of the value handled by the receiver.

## Parameters

### callbackOrReceiver?

An optional function to serve as the `next` handler,
or a `Receiver` object with one or more optional handlers.

(`value`) => `any` | [`Receiver`](../type-aliases/Receiver.md)\<`T`\>

## Returns

[`StrictReceiver`](../type-aliases/StrictReceiver.md)\<`T`\>

A new `StrictReceiver` instance with normalized handlers and completion tracking.
