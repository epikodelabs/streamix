# Type Alias: ReplaySubject\<T\>

> **ReplaySubject**\<`T`\> = [`Subject`](Subject.md)\<`T`\>

Defined in: [subjects/replaySubject.ts:28](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/subjects/replaySubject.ts#L28)

A type alias for a ReplaySubject, which is a type of Subject.

A ReplaySubject stores a specified number of the latest values it has emitted
and "replays" them to any new subscribers. This allows late subscribers to
receive past values they may have missed.

## Type Parameters

### T

`T` = `any`

The type of the values emitted by the subject.
