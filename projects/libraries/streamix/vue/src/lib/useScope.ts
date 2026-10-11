import {
  getCurrentScope,
  onScopeDispose,
} from 'vue';
import type { Scope } from '@epikodelabs/streamix';

/**
 * Creates a Streamix scope whose lifetime is tied to the current Vue effect
 * scope.
 *
 * Calling this outside an active Vue effect scope throws before the Streamix
 * scope is created, so owned work cannot escape without a disposer.
 *
 * Vue component `setup()` functions already run inside an effect scope, so the
 * Streamix scope is disposed automatically when the component unmounts. The
 * same behavior works inside an explicit `effectScope()`.
 *
 * Unlike React, Vue setup is not re-run on every render, so no memo/ref cache is
 * needed here: the factory naturally runs once per composable invocation.
 */
export function useScope<T extends Scope<any>>(factory: () => T): T {
  if (!getCurrentScope()) {
    throw new Error(
      'useScope() must run inside Vue setup() or an active effectScope().',
    );
  }
  const instance = factory();
  onScopeDispose(() => instance.dispose());

  return instance;
}
