// Pure helpers shared by the builder and its test suite. This module must
// stay free of Node-only imports so the browser test suite can load it.

// Default keeps the in-repo app6 demo building; consuming workspaces pass
// their own `sourceRoot` builder option.
export const DEFAULT_SOURCE_ROOT = 'projects/apps/app6/src';

export function resolveSourceRoot(options) {
  return options?.sourceRoot || DEFAULT_SOURCE_ROOT;
}

/**
 * Drops this builder's own keys plus the empty placeholders the CLI's schema
 * validation materializes, so only real options reach the delegate target.
 */
export function buildDelegateOptions(options) {
  const delegateOptions = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    if (key === 'delegateTarget' || key === 'sourceRoot') {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    if (
      Array.isArray(value)
        ? value.length === 0
        : typeof value === 'object' && Object.keys(value).length === 0
    ) {
      continue;
    }
    delegateOptions[key] = value;
  }
  return delegateOptions;
}

/**
 * A watcher event schedules regeneration unless a specific file is
 * configured. With no configured file every event qualifies: `null` arrives
 * on platforms that do not report entry names, and recursive watchers
 * report entry paths relative to the watched root.
 */
export function shouldRegenerateOn(filename, configuredFile) {
  if (filename === null || !configuredFile) {
    return true;
  }
  return String(filename).split(/[\\/]/).pop() === configuredFile;
}

/** Maps an application source root to its virtual project root. */
export function virtualRootOf(sourceRoot) {
  return `.angular/streamix/${sourceRoot
    .replace(/^projects\/apps\//, '')
    .replace(/\/src$/, '')}/src`;
}

/** Maps a virtual entry to the source entry it is generated from. */
export function sourceTwinOf(virtualPath) {
  return virtualPath.replace(/\.sx\.ts$/, '.ts');
}

/**
 * Serializes generated template text as a backtick literal so the virtual
 * component stays readable. Escapes cover exactly what template literals
 * interpret: backslashes, backticks, and `${` interpolation starts.
 */
export function templateLiteral(text) {
  return '`' + text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${') + '`';
}
