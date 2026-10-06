import { SX_SOURCE_REFERENCES_FIELD } from './generated-names';

const DEFAULT_RUNTIME_IMPORT = '@epikodelabs/streamix/angular';

/**
 * Runtime primitives referenced by emitted setup functions. Generated setup is
 * inlined into the component module, so these symbols join the component's
 * runtime import.
 */
export const SX_SETUP_RUNTIME_SYMBOLS = [
  'createBindingTable',
  'ɵsxAttribute',
  'ɵsxClass',
  'ɵsxClassMap',
  'ɵsxInvalidate',
  'ɵsxProperty',
  'ɵsxStyle',
  'ɵsxStyleMap',
  'ɵsxText',
  'ɵsxTextNode',
  'ɵsxTextExpression',
  'ɵsxTextExpressionNode',
] as const;

/**
 * Emits the runtime import header shared by generated setup modules.
 */
export function emitRuntimeImportHeader(
  runtimeImport: string = DEFAULT_RUNTIME_IMPORT,
): string {
  return [
    `import {`,
    ...SX_SETUP_RUNTIME_SYMBOLS.map(symbol => `  ${symbol},`),
    `} from ${JSON.stringify(runtimeImport)};`,
  ].join('\n');
}

/**
 * Generated component-field initializer.
 *
 * Example:
 *
 *   private readonly ɵsx = ɵinstallSxCompiledView(
 *     this,
 *     ɵsetupSxBindings,
 *   );
 *
 * The helper returns void; the field exists only to execute setup in Angular's
 * injection context.
 */
export interface SxLifecycleInitializerOptions {
  readonly sourceReferences?: readonly string[];
  readonly angularInvalidation?: boolean;
}

/**
 * Generated per-component source-reference registry.
 *
 * The field is public because compiler-rewritten structural microsyntax reads
 * `__sxRefs.<field>` from the Angular template. Authored code does not need to
 * reference it.
 */
export function emitSourceReferenceInitializer(
  sourceReferences: readonly string[],
): string {
  return [
    `public readonly ${SX_SOURCE_REFERENCES_FIELD} = ɵinstallSxSourceReferences(`,
    `  this,`,
    `  ${JSON.stringify(sourceReferences)},`,
    `);`,
  ].join('\n');
}

export function emitLifecycleInitializer(
  setupName = 'ɵsetupSxBindings',
  options: SxLifecycleInitializerOptions = {},
): string {
  const sourceReferences = options.sourceReferences ?? [];
  const lines: string[] = [];

  if (sourceReferences.length > 0) {
    lines.push(emitSourceReferenceInitializer(sourceReferences));
    lines.push('');
  }

  lines.push(
    `protected readonly ɵsx = ɵinstallSxCompiledView(`,
    `  this,`,
    `  ${setupName},`,
  );

  const needsOptions =
    sourceReferences.length > 0 ||
    options.angularInvalidation === true;

  if (needsOptions) {
    lines.push(`  {`);

    if (sourceReferences.length > 0) {
      lines.push(`    sourceReferences: this.${SX_SOURCE_REFERENCES_FIELD},`);
    }

    if (options.angularInvalidation) {
      lines.push(`    angularInvalidation: true,`);
    }

    lines.push(`  },`);
  }

  lines.push(`);`);
  return lines.join('\n');
}