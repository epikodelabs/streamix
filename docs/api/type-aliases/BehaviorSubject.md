# Type Alias: BehaviorSubject\<T\>

> **BehaviorSubject**\<`T`\> = [`Subject`](Subject.md)\<`T`\> & `object`

Defined in: [subjects/behaviorSubject.ts:28](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/subjects/behaviorSubject.ts#L28)

A BehaviorSubject is a special type of Subject that maintains
a current value and emits that value immediately to new subscribers.
It allows synchronous retrieval of the latest emitted value via `.snappy`.

It is "stateful" in that it remembers the last value it emitted.

## Type declaration

### snappy

#### Get Signature

> **get** **snappy**(): `T`

Provides synchronous access to the most recently pushed value.
This value is the last value passed to the `next()` method, or the initial value if none have been emitted.

##### Returns

`T`

## Type Parameters

### T

`T` = `any`

The type of the values held and emitted by the subject.
