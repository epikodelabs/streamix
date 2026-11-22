import {
  getCurrentInstance,
  getCurrentScope,
  hasInjectionContext,
  inject,
  onScopeDispose,
  ssrContextKey,
  type EffectScope,
  type InjectionKey,
} from 'vue';
import { ɵcreateDisposer, ɵtrackDisposal } from '@epikodelabs/streamix';

/** The piece of Vue's server render context this adapter relies on. */
interface SSRDisposalContext {
  /**
   * Disposers Vue runs after the render completes or fails. Vue registers
   * synchronous watchers created during SSR here, and both `renderToString`
   * and the streaming renderers drain the array.
   */
  __watcherHandles?: Array<() => void>;
}

function ssrRenderContext(): SSRDisposalContext | null {
  if (!getCurrentInstance() || !hasInjectionContext()) {
    return null;
  }

  // The Vue runtime exports the injection key but not its context type.
  return inject<SSRDisposalContext | null>(
    ssrContextKey as unknown as InjectionKey<SSRDisposalContext | null>,
    null,
  );
}

/** True while rendering inside Vue's server renderer. */
export function isSSRContext(): boolean {
  return ssrRenderContext() !== null;
}

/**
 * Starts cleanup at Vue's lifecycle boundary and makes its completion
 * available to waitForDisposal for the effect scope, app, and SSR request.
 */
export function registerVueDisposal(dispose: () => unknown): void {
  // Vue stops attached effect scopes recursively. Capture the parent chain
  // before stop() detaches the scopes. Detached scopes have no parent.
  type AttachedEffectScope = EffectScope & { readonly parent?: AttachedEffectScope };
  const scopes: EffectScope[] = [];
  for (let scope = getCurrentScope() as AttachedEffectScope | undefined; scope; scope = scope.parent) {
    scopes.push(scope);
  }
  const app = getCurrentInstance()?.appContext.app;
  const context = ssrRenderContext();
  const stop = ɵcreateDisposer(queue => queue.run(dispose));
  const run = () => {
    const completion = stop();
    for (const scope of scopes) ɵtrackDisposal(scope, completion);
    if (app) ɵtrackDisposal(app, completion);
    if (context) ɵtrackDisposal(context, completion);
    void completion.catch(error => {
      console.error('[streamix] Vue disposal failed:', error);
    });
  };
  onScopeDispose(run);
  // The server renderer drains these callbacks without stopping component scopes.
  if (context) (context.__watcherHandles ??= []).push(run);
}
