# Function: fromEvent()

> **fromEvent**(`target`, `event`): [`Stream`](../type-aliases/Stream.md)\<`Event`\>

Defined in: [streams/fromEvent.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/streams/fromEvent.ts#L16)

Creates a stream that emits events of the specified type from the given EventTarget.

This function provides a reactive way to handle DOM events or other events,
such as mouse clicks, keyboard presses, or custom events. The stream
will emit a new event object each time the event is dispatched.

## Parameters

### target

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`EventTarget`\>

The event target to listen to (e.g., a DOM element, `window`, or `document`).

### event

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`string`\>

The name of the event to listen for (e.g., 'click', 'keydown').

## Returns

[`Stream`](../type-aliases/Stream.md)\<`Event`\>

A stream that emits the event objects as they occur.
