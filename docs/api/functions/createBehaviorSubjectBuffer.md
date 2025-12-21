# Function: createBehaviorSubjectBuffer()

> **createBehaviorSubjectBuffer**\<`T`\>(`initialValue?`): [`SubjectBuffer`](../type-aliases/SubjectBuffer.md)\<`T`\>

Defined in: [primitives/buffer.ts:297](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L297)

Creates a BehaviorSubject Buffer. It extends the Subject Buffer by:
1. Storing the single latest value (or error).
2. Delivering the latest value to new readers upon attachment (replaying 1 item).
3. Exposing the current value via the `.value` getter.

## Type Parameters

### T

`T` = `any`

## Parameters

### initialValue?

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`T`\>

## Returns

[`SubjectBuffer`](../type-aliases/SubjectBuffer.md)\<`T`\>
