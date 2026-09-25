/**
 * Schedules `dispose()` on a microtask, cancellable via
 * {@link cancelDeferredDispose}.
 *
 * This exists to absorb React StrictMode's dev-only synchronous
 * mount -> unmount -> remount cycle. That cycle runs an effect's cleanup
 * and then its setup again *without* a new render in between — so a naive
 * "dispose in cleanup, recreate on next render" hook is left holding a
 * disposed instance with nothing to trigger a recreation. Deferring the
 * actual dispose by one microtask means the remount's setup (which runs
 * synchronously, before any microtask gets a chance to flush) can cancel
 * it, so the instance survives StrictMode's churn untouched. A genuine
 * unmount — where no remount follows — still disposes almost immediately,
 * just not perfectly synchronously.
 */
const pending = new WeakMap<object, { cancelled: boolean }>();

export function deferDispose(instance: object, dispose: () => void): void {
  const token = { cancelled: false };
  pending.set(instance, token);

  queueMicrotask(() => {
    if (token.cancelled) return;
    pending.delete(instance);
    dispose();
  });
}

export function cancelDeferredDispose(instance: object): void {
  const token = pending.get(instance);
  if (token) {
    token.cancelled = true;
    pending.delete(instance);
  }
}
