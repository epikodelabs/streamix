import ts from 'typescript';

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

/** A static inline @Component template and its exact literal source span. */
export interface InlineSxTemplate {
  readonly template: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Finds a template by its TypeScript syntax, not by the decorator's formatting,
 * neighbouring metadata members, or the first backtick encountered.
 */
export function findInlineSxTemplate(source: string): InlineSxTemplate | undefined {
  const file = ts.createSourceFile('sx-component.ts', source, ts.ScriptTarget.Latest, true);
  let found: InlineSxTemplate | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isClassDeclaration(node)) {
      for (const decorator of ts.getDecorators(node) ?? []) {
        if (!ts.isCallExpression(decorator.expression) ||
            !ts.isIdentifier(decorator.expression.expression) ||
            decorator.expression.expression.text !== 'Component') continue;
        const metadata = decorator.expression.arguments[0];
        if (!metadata || !ts.isObjectLiteralExpression(metadata)) continue;
        for (const property of metadata.properties) {
          if (!ts.isPropertyAssignment(property) ||
              property.name.getText(file).replace(/["']/g, '') !== 'template') continue;
          const literal = property.initializer;
          if (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) {
            found = {
              template: literal.text,
              start: literal.getStart(file),
              end: literal.end,
            };
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (found) return found;
  // A real decorator with a computed/dynamic template must not accidentally
  // adopt a lookalike `template:` token from unrelated source text.
  if (/@Component\s*\(/.test(source)) return undefined;
  // Backwards-compatible support for a decorator metadata fragment (used by
  // callers that only reprint `template: ...` rather than the whole class).
  // A TypeScript scanner, not a delimiter regex, determines the literal end.
  const fragment = /\btemplate\s*:\s*/.exec(source);
  if (!fragment) return undefined;
  const start = fragment.index + fragment[0].length;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.slice(start),
  );
  const kind = scanner.scan();
  if (kind !== ts.SyntaxKind.FirstTemplateToken &&
      kind !== ts.SyntaxKind.StringLiteral) return undefined;
  if (scanner.getTokenText().endsWith('${')) return undefined;
  return { template: scanner.getTokenValue(), start, end: start + scanner.getTextPos() };
}

/**
 * Replaces the literal in the reprinted component. Preserve all other
 * decorator metadata and the reprinted class/lifecycle setup unchanged.
 */
export function installTransformedTemplate(
  reprintedSource: string,
  transformedTemplate: string,
): string {
  const match = findInlineSxTemplate(reprintedSource);
  if (!match) {
    throw new Error(
      'The reprinted component no longer contains an inline template (static @Component template required); the transformed template cannot be installed.',
    );
  }
  return reprintedSource.slice(0, match.start) +
    templateLiteral(transformedTemplate) + reprintedSource.slice(match.end);
}
