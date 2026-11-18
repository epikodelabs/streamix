import {
  getCurrentInstance,
  hasInjectionContext,
  inject,
  ssrContextKey,
  type InjectionKey,
} from 'vue';

/** The piece of Vue's server render context this adapter relies on. */
interface SSRDisposalContext {
  /**
   * Disposers Vue runs after the render completes or fails. Vue registers
   * synchronous watchers created during SSR here, and both `renderToString`
   * and the streaming renderers drain the array.
   */
  __watcherHandles?: Array<() => void>;
}

/**
 * Registers a disposer with the active server render.
 *
 * Vue's server renderer creates a component effect scope per request but never
 * stops it, so `onScopeDispose` alone never runs on the server. Bridges and
 * compiler-owned Streamix scopes would otherwise outlive the render and keep
 * their subscriptions (and iterators) alive. Returning `false` outside an SSR
 * component setup leaves ownership with the Vue effect scope.
 */
export function registerSSRDisposal(dispose: () => void): boolean {
  if (!getCurrentInstance() || !hasInjectionContext()) {
    return false;
  }

  // The Vue runtime exports the injection key but not its context type.
  const context = inject<SSRDisposalContext | null>(
    ssrContextKey as unknown as InjectionKey<SSRDisposalContext | null>,
    null,
  );

  if (!context) {
    return false;
  }

  if (!Array.isArray(context.__watcherHandles)) {
    context.__watcherHandles = [];
  }
  context.__watcherHandles.push(dispose);
  return true;
}
