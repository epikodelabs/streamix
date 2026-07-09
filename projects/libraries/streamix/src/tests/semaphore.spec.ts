import { createSemaphore } from '@epikodelabs/streamix';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createSemaphore', () => {
  it('releases queued acquires on a later microtask', async () => {
    const semaphore = createSemaphore(0);
    let resolved = false;

    const pending = semaphore.acquire().then(release => {
      resolved = true;
      return release;
    });

    await flush();
    expect(resolved).toBeFalse();

    semaphore.release();

    expect(resolved).toBeFalse();

    const release = await pending;
    expect(resolved).toBeTrue();

    release();
  });

  it('makes a permit available when released without waiters', async () => {
    const semaphore = createSemaphore(1);

    const release = semaphore.tryAcquire();
    expect(release).toEqual(jasmine.any(Function));
    expect(semaphore.tryAcquire()).toBeNull();

    semaphore.release();

    const nextRelease = semaphore.tryAcquire();
    expect(nextRelease).toEqual(jasmine.any(Function));

    nextRelease?.();
    await flush();
  });
});
