# Type Alias: Scheduler

> **Scheduler** = `object`

Defined in: [abstractions/scheduler.ts:19](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/scheduler.ts#L19)

Functional Scheduler

Guarantees:
- FIFO execution (one task at a time)
- Supports synchronous and asynchronous tasks
- Errors reject the task promise but do NOT stop the queue
- `flush()` is microtask-stable:
  it resolves only after the queue stays empty
  across a microtask turn (prevents “flush lies”)

Performance optimizations:
- Parallel arrays instead of per-task objects
- At most one pump in flight
- Compact storage for flush waiters

## Properties

### enqueue()

> **enqueue**: \<`T`\>(`fn`) => `Promise`\<`T`\>

Defined in: [abstractions/scheduler.ts:26](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/scheduler.ts#L26)

Enqueue a task for serialized execution.

The task may return a value or a promise.
The returned promise resolves or rejects with the task result.

#### Type Parameters

##### T

`T`

#### Parameters

##### fn

() => `Promise`\<`T`\> \| `T`

#### Returns

`Promise`\<`T`\>

***

### flush()

> **flush**: () => `Promise`\<`void`\>

Defined in: [abstractions/scheduler.ts:32](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/abstractions/scheduler.ts#L32)

Resolves when the scheduler becomes idle and
remains idle across a microtask boundary.

#### Returns

`Promise`\<`void`\>
