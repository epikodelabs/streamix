# Function: createReplaySubject()

> **createReplaySubject**\<`T`\>(`capacity?`): [`ReplaySubject`](../type-aliases/ReplaySubject.md)\<`T`\>

Defined in: [subjects/replaySubject.ts:43](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/subjects/replaySubject.ts#L43)

Creates a new ReplaySubject.

A ReplaySubject is a variant of a Subject that stores a specified number of
the latest values it has emitted and "replays" them to any new subscribers.
This allows late subscribers to receive past values they may have missed.

This subject provides asynchronous delivery and scheduling via a global scheduler.

## Type Parameters

### T

`T` = `any`

The type of the values the subject will emit.

## Parameters

### capacity?

`number` = `Infinity`

The maximum number of past values to buffer and replay to new subscribers.

## Returns

[`ReplaySubject`](../type-aliases/ReplaySubject.md)\<`T`\>

A new ReplaySubject instance.
