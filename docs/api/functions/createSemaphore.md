# Function: createSemaphore()

> **createSemaphore**(`initialCount`): [`Semaphore`](../interfaces/Semaphore.md)

Defined in: [primitives/semaphore.ts:41](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/semaphore.ts#L41)

Creates a semaphore for controlling access to a limited number of resources.

A semaphore is a synchronization primitive that allows you to manage
concurrent access to resources by maintaining a count of available "permits."

## Parameters

### initialCount

`number`

The initial number of permits available. Must be a non-negative integer.

## Returns

[`Semaphore`](../interfaces/Semaphore.md)

A semaphore object with `acquire`, `tryAcquire`, and `release` methods.
