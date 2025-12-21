# Function: createSubject()

> **createSubject**\<`T`\>(`scheduler`): [`Subject`](../type-aliases/Subject.md)\<`T`\>

Defined in: [subjects/subject.ts:68](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/subjects/subject.ts#L68)

Creates a new Subject instance.

A Subject can be used to manually control a stream, emitting values
to all active subscribers. It is a fundamental building block for
reactive patterns like event bus systems or shared state management.

## Type Parameters

### T

`T` = `any`

The type of the values that the subject will emit.

## Parameters

### scheduler

[`Scheduler`](../type-aliases/Scheduler.md) = `globalScheduler`

## Returns

[`Subject`](../type-aliases/Subject.md)\<`T`\>

A new Subject instance.
