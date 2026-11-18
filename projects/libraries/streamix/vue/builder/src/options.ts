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
