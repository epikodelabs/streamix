// Pure helpers shared by the builder and its test suite. This module must
// stay free of Node-only imports so the browser test suite can load it.

/** Options understood by this builder. Everything else is forwarded. */
export interface SxBuilderOptions {
  readonly delegateTarget: string;
  readonly sourceRoot?: string;
  readonly [key: string]: unknown;
}

// Default keeps the in-repo app6 demo building; consuming workspaces pass
// their own `sourceRoot` builder option.
export const DEFAULT_SOURCE_ROOT = 'projects/apps/app6/src';

export function resolveSourceRoot(options?: Record<string, unknown>): string {
  const sourceRoot = options?.['sourceRoot'];

  return typeof sourceRoot === 'string' && sourceRoot
    ? sourceRoot
    : DEFAULT_SOURCE_ROOT;
}

/**
 * Drops this builder's own keys plus the empty placeholders the CLI's schema
 * validation materializes, so only real options reach the delegate target.
 */
/**
 * Accepts untyped values because the CLI materializes empty placeholders and
 * callers may pass `undefined`; the result is narrowed for the delegate.
 */
export function buildDelegateOptions(
  options?: Record<string, unknown>,
): Record<string, unknown> {
  const delegateOptions: Record<string, unknown> = {};

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
export function shouldRegenerateOn(
  filename: string | Buffer | null,
  configuredFile: string,
): boolean {
  if (filename === null || !configuredFile) {
    return true;
  }

  return String(filename).split(/[\\/]/).pop() === configuredFile;
}

/** Maps an application source root to its virtual project root. */
export function virtualRootOf(sourceRoot: string): string {
  return `.angular/.streamix/${sourceRoot
    .replace(/^projects\/apps\//, '')
    .replace(/\/src$/, '')}/src`;
}

/** Generated tsconfig used by the delegated Angular compiler. */
export function virtualTsconfigOf(sourceRoot: string): string {
  return virtualRootOf(sourceRoot).replace(/\/src$/, '/tsconfig.app.json');
}

/**
 * Serializes generated template text as a backtick literal so the virtual
 * component stays readable. Escapes cover exactly what template literals
 * interpret: backslashes, backticks, and `${` interpolation starts.
 */
export function templateLiteral(text: string): string {
  return '`' + text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${') + '`';
}

/** Matches an inline template immediately followed by a styles literal. */
const INLINE_TEMPLATE = /template:\s*`([\s\S]*?)`,\s*styles:/;

/**
 * Installs the transformed template into the reprinted component source.
 *
 * The lifecycle install reprints the component, which normalizes line endings
 * and reindents the decorator, so the template occurrence matched on the raw
 * source may no longer exist there verbatim. Anchor on the reprinted output —
 * and refuse to continue silently: a component whose transformed template is
 * not written back would render Angular's own control flow while the compiled
 * setup walks marker paths that do not exist, crashing at runtime with no
 * build-time signal.
 */
export function installTransformedTemplate(
  reprintedSource: string,
  transformedTemplate: string,
): string {
  const match = INLINE_TEMPLATE.exec(reprintedSource);

  if (!match) {
    throw new Error(
      'The reprinted component no longer contains an inline template followed by styles; the transformed template cannot be installed.',
    );
  }

  // Function replacer: a plain string replacement would interpret `$`
  // sequences inside the template as replacement patterns.
  return reprintedSource.replace(
    match[0],
    () => `template: ${templateLiteral(transformedTemplate)},\n  styles:`,
  );
}
