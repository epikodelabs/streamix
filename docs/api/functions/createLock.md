# Function: createLock()

> **createLock**(): [`SimpleLock`](../interfaces/SimpleLock.md)

Defined in: [primitives/lock.ts:25](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/lock.ts#L25)

Creates a simple asynchronous lock mechanism. Only one caller can hold the lock at a time.
Subsequent calls will queue up and wait for the lock to be released. This is useful
for synchronizing access to shared resources in an asynchronous environment.

The function returns a promise that resolves with a `ReleaseFn`. The caller must
invoke this function to release the lock, allowing the next queued caller to proceed.

## Returns

[`SimpleLock`](../interfaces/SimpleLock.md)

A function that, when called, returns a promise to acquire the lock.
