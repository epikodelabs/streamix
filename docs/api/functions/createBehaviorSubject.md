# Function: createBehaviorSubject()

> **createBehaviorSubject**\<`T`\>(`initialValue`): [`BehaviorSubject`](../type-aliases/BehaviorSubject.md)\<`T`\>

Defined in: [subjects/behaviorSubject.ts:49](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/subjects/behaviorSubject.ts#L49)

Creates a BehaviorSubject that holds a current value and emits it immediately to new subscribers.
It maintains the latest value internally and allows synchronous access via the `snappy` getter.

The subject queues emitted values and delivers them to subscribers asynchronously,
supporting safe concurrent access and orderly processing.

## Type Parameters

### T

`T` = `any`

The type of the values the subject will hold.

## Parameters

### initialValue

`T`

The value that the subject will hold upon creation.

## Returns

[`BehaviorSubject`](../type-aliases/BehaviorSubject.md)\<`T`\>

A new BehaviorSubject instance.
