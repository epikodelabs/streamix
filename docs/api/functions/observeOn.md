# Function: observeOn()

> **observeOn**\<`T`\>(`context`): [`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

Defined in: [operators/observeOn.ts:42](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/observeOn.ts#L42)

Creates a stream operator that schedules the emission of each value from the source
stream on a specified JavaScript task queue.

This operator is a scheduler. It decouples the timing of value production from
its consumption, allowing you to control when values are emitted to downstream
operators. This is essential for preventing long-running synchronous operations
from blocking the main thread and for prioritizing different types of work.

The operator supports three contexts:
- `"microtask"`: Emits the value at the end of the current task using `queueMicrotask`.
- `"macrotask"`: Emits the value in the next event loop cycle using `setTimeout(0)`.
- `"idle"`: Emits the value when the browser is idle using `requestIdleCallback`.

## Type Parameters

### T

`T` = `any`

The type of the values in the source and output streams.

## Parameters

### context

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`"microtask"` \| `"macrotask"` \| `"idle"`\>

The JavaScript task queue context to schedule emissions on.

## Returns

[`Operator`](../type-aliases/Operator.md)\<`T`, `T`\>

An `Operator` instance that can be used in a stream's `pipe` method.
