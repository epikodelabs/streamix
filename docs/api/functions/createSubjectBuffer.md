# Function: createSubjectBuffer()

> **createSubjectBuffer**\<`T`\>(): [`CyclicBuffer`](../type-aliases/CyclicBuffer.md)\<`T`\>

Defined in: [primitives/buffer.ts:85](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L85)

Creates a Subject Buffer. It acts as a queuing stream:
1. Values are buffered only if active readers are present.
2. New readers DO NOT receive past values (non-replaying).
3. Multiple writes are delivered to readers in order (queued).

## Type Parameters

### T

`T` = `any`

## Returns

[`CyclicBuffer`](../type-aliases/CyclicBuffer.md)\<`T`\>
