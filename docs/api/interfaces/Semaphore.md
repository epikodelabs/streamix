# Interface: Semaphore

Defined in: [primitives/semaphore.ts:9](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/semaphore.ts#L9)

An interface for a semaphore, a synchronization primitive for controlling
access to a limited number of resources.

## Properties

### acquire()

> **acquire**: () => `Promise`\<[`ReleaseFn`](../type-aliases/ReleaseFn.md)\>

Defined in: [primitives/semaphore.ts:16](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/semaphore.ts#L16)

Acquires a permit from the semaphore. If no permits are available,
this promise-based method will block until a permit is released.

#### Returns

`Promise`\<[`ReleaseFn`](../type-aliases/ReleaseFn.md)\>

A promise that resolves with a function to call to release the permit.

***

### tryAcquire()

> **tryAcquire**: () => `null` \| [`ReleaseFn`](../type-aliases/ReleaseFn.md)

Defined in: [primitives/semaphore.ts:23](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/semaphore.ts#L23)

Attempts to acquire a permit from the semaphore without blocking.

#### Returns

`null` \| [`ReleaseFn`](../type-aliases/ReleaseFn.md)

A function to call to release the permit if one was acquired, otherwise `null`.

***

### release()

> **release**: () => `void`

Defined in: [primitives/semaphore.ts:29](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/semaphore.ts#L29)

Releases a permit back to the semaphore. This unblocks the next waiting
`acquire` call in the queue or increments the available permit count.

#### Returns

`void`
