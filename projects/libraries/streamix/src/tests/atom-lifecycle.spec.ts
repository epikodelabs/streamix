import { AtomLifecycle, type AtomLifecycleSession } from '../lib/atoms/lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('AtomLifecycle', () => {
  it('starts once for multiple consumers and disposes on the last detach', async () => {
    const start = jasmine.createSpy('start');
    const release = jasmine.createSpy('release');
    const dispose = jasmine.createSpy('dispose');
    const lifecycle = new AtomLifecycle({ start, release, dispose });
    expect(start).not.toHaveBeenCalled();
    lifecycle.addSubscriber();
    lifecycle.addSubscriber();
    expect(start).toHaveBeenCalledTimes(1);
    await lifecycle.removeSubscriber();
    expect(release).not.toHaveBeenCalled();
    await lifecycle.removeSubscriber();
    expect(lifecycle.disposed).toBeTrue();
    expect(lifecycle.subscriberCount).toBe(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    await lifecycle.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps a session active while an iterator reference remains', async () => {
    const release = jasmine.createSpy('release');
    const lifecycle = new AtomLifecycle({ start() {}, release }, 'stop');
    lifecycle.addSubscriber();
    lifecycle.retain();
    await lifecycle.removeSubscriber();
    expect(release).not.toHaveBeenCalled();
    await lifecycle.releaseRef();
    expect(release).toHaveBeenCalledTimes(1);
    expect(lifecycle.disposed).toBeFalse();
    await lifecycle.dispose();
  });

  it('rejects retired sessions and activates a new generation on reconnect', async () => {
    const sessions: AtomLifecycleSession[] = [];
    const lifecycle = new AtomLifecycle({ start: session => { sessions.push(session); } }, 'stop');
    lifecycle.addSubscriber();
    await lifecycle.removeSubscriber();
    expect(lifecycle.canEmit(sessions[0])).toBeFalse();
    expect(sessions[0].active).toBeFalse();
    lifecycle.addSubscriber();
    expect(sessions[1].generation).toBeGreaterThan(sessions[0].generation);
    expect(lifecycle.canEmit(sessions[1])).toBeTrue();
    await lifecycle.dispose();
  });

  it('releases cleanup returned after retirement without replacing the new session', async () => {
    const pending = deferred<() => void>();
    const oldCleanup = jasmine.createSpy('old cleanup');
    const currentCleanup = jasmine.createSpy('current cleanup');
    let starts = 0;
    const lifecycle = new AtomLifecycle({ start: () => ++starts === 1 ? pending.promise : currentCleanup }, 'stop');
    lifecycle.addSubscriber();
    await lifecycle.removeSubscriber();
    lifecycle.addSubscriber();
    pending.resolve(oldCleanup);
    await tick();
    expect(oldCleanup).toHaveBeenCalledTimes(1);
    expect(currentCleanup).not.toHaveBeenCalled();
    await lifecycle.dispose();
    expect(oldCleanup).toHaveBeenCalledTimes(1);
    expect(currentCleanup).toHaveBeenCalledTimes(1);
  });

  it('ignores startup failures belonging to retired sessions', async () => {
    const pending = deferred<void>();
    const error = jasmine.createSpy('error');
    let starts = 0;
    const lifecycle = new AtomLifecycle({ start: () => {
      if (++starts === 1) return pending.promise;
      return undefined;
    }, error }, 'stop');
    lifecycle.addSubscriber();
    await lifecycle.removeSubscriber();
    lifecycle.addSubscriber();
    pending.reject(new Error('retired'));
    await tick();
    expect(error).not.toHaveBeenCalled();
    expect(starts).toBe(2);
    await lifecycle.dispose();
  });

  it('latches completion without disposing retained atom state or restarting', async () => {
    const cleanup = jasmine.createSpy('cleanup');
    const start = jasmine.createSpy('start').and.returnValue(cleanup);
    const lifecycle = new AtomLifecycle({ start });
    lifecycle.addSubscriber();
    await lifecycle.complete();
    expect(lifecycle.completed).toBeTrue();
    await lifecycle.removeSubscriber();
    lifecycle.addSubscriber();
    expect(start).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(lifecycle.disposed).toBeFalse();
    await lifecycle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps producers alive across subscriber gaps when configured', async () => {
    const cleanup = jasmine.createSpy('cleanup');
    const lifecycle = new AtomLifecycle({ start: () => cleanup }, 'keepAlive');
    lifecycle.activate();
    lifecycle.addSubscriber();
    await lifecycle.removeSubscriber();
    expect(cleanup).not.toHaveBeenCalled();
    await lifecycle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('invalidates immediately and shares teardown across concurrent disposal requests', async () => {
    const pending = deferred<void>();
    let session!: AtomLifecycleSession;
    const release = jasmine.createSpy('release').and.returnValue(pending.promise);
    const lifecycle = new AtomLifecycle({ start: value => { session = value; }, release });
    lifecycle.activate();
    const first = lifecycle.dispose();
    expect(lifecycle.canEmit(session)).toBeFalse();
    expect(lifecycle.dispose()).toBe(first);
    expect(release).toHaveBeenCalledTimes(1);
    pending.resolve();
    await first;
  });

  it('waits for retirement when adapter release reenters disposal', async () => {
    const pending = deferred<void>();
    let disposal!: Promise<void>;
    const lifecycle = new AtomLifecycle({
      start() {},
      release() {
        disposal = lifecycle.dispose();
        return pending.promise;
      },
    });
    lifecycle.activate();
    const completed = lifecycle.complete();
    let disposed = false;
    void disposal.then(() => { disposed = true; });
    await tick();
    expect(disposed).toBeFalse();
    pending.resolve();
    await Promise.all([completed, disposal]);
    expect(disposed).toBeTrue();
  });

  it('settles teardown even when source cleanup throws', async () => {
    const lifecycle = new AtomLifecycle({ start: () => () => { throw new Error('cleanup'); } });
    lifecycle.activate();
    await expectAsync(lifecycle.dispose()).toBeResolved();
    expect(lifecycle.disposed).toBeTrue();
  });
});
