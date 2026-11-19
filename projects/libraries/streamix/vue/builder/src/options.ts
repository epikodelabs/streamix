// Pure helpers shared by the builder and its test suite. This module must
// stay free of Node-only imports so the browser test suite can load it.

/** True only for live serve/watch runs; one-shot builds allocate no source watcher. */
export function shouldWatchSources(
  delegatedTarget: string,
  invokingTarget: string | undefined,
  watch: unknown,
): boolean {
  return watch === true ||
    delegatedTarget === 'serve' || delegatedTarget === 'dev-server' ||
    invokingTarget === 'serve' || invokingTarget === 'dev-server';
}

export interface StreamixPluginSanitizeResult {
  readonly plugins: unknown[];
  /** Number of `sxVue()` plugin instances removed. */
  readonly removed: number;
}

/**
 * Removes Streamix's own Vite plugin from a delegate config.
 *
 * The hosted builder has already transformed the virtual SFC tree, so running
 * `sxVue()` again would re-transform generated bridges and collide on
 * `__sx_*` declarations. Nested plugin arrays and falsy entries are handled
 * like Vite handles them.
 */
export function stripStreamixVuePlugins(
  plugins: readonly unknown[],
): StreamixPluginSanitizeResult {
  let removed = 0;

  const visit = (option: unknown): unknown[] => {
    if (Array.isArray(option)) return option.flatMap(visit);
    if (!option || (typeof option !== 'object' && typeof option !== 'function')) {
      return [];
    }
    if ((option as { name?: unknown }).name === 'streamix-vue') {
      removed += 1;
      return [];
    }
    return [option];
  };

  return { plugins: plugins.flatMap(visit), removed };
}
