# Function: createReplayBuffer()

> **createReplayBuffer**\<`T`\>(`capacity`): [`ReplayBuffer`](../type-aliases/ReplayBuffer.md)\<`T`\>

Defined in: [primitives/buffer.ts:510](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L510)

Creates a Replay Buffer with a fixed capacity. It acts as a history stream:
1. Buffers the last 'capacity' number of items (circular buffer).
2. New readers start from the oldest available item within the capacity window (replaying).
3. Supports backpressure via a Semaphore when the buffer is full.

## Type Parameters

### T

`T` = `any`

## Parameters

### capacity

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`number`\>

## Returns

[`ReplayBuffer`](../type-aliases/ReplayBuffer.md)\<`T`\>
