import { SX_SOURCE_REFERENCES_FIELD } from './generated-names';

/**
 * Runtime primitives referenced by emitted setup functions. Generated setup is
 * inlined into the component module, so these symbols join the component's
 * runtime import.
 */
export const SX_SETUP_RUNTIME_SYMBOLS = [
  'createBindingTable',
  'ɵcreateSxConditionalBlock',
  'ɵcreateSxCompiledBlock',
  'ɵcreateSxKeyedBlock',
  'ɵsxBlockAnchor',
  'ɵsxReadLocal',
  'ɵsxRestoreBlockMarker',
  'ɵsxString',
  'ɵsxAttribute',
  'ɵsxAttributeExpression',
  'ɵsxClass',
  'ɵsxClassExpression',
  'ɵsxClassMap',
  'ɵsxProperty',
  'ɵsxPropertyExpression',
  'ɵsxStyle',
  'ɵsxStyleExpression',
  'ɵsxStyleMap',
  'ɵsxText',
  'ɵsxTextNode',
  'ɵsxTextExpression',
  'ɵsxTextExpressionNode',
] as const;

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

/**
 * Generated fields that do not depend on the compiled setup. Only the source
 * reference bridge exists today; it is emitted on its own when a component
 * needs no binding table.
 */
export function emitComponentFieldInitializers(options: {
  readonly sourceReferences?: readonly string[];
}): string {
  const sourceReferences = options.sourceReferences ?? [];

  return sourceReferences.length > 0
    ? emitSourceReferenceInitializer(sourceReferences)
    : '';
}

export function emitLifecycleInitializer(
  setupName = 'ɵsetupSxBindings',
  options: SxLifecycleInitializerOptions = {},
): string {
  const sourceReferences = options.sourceReferences ?? [];
  const lines: string[] = [];
  const fields = emitComponentFieldInitializers(options);

  if (fields) {
    lines.push(fields);
    lines.push('');
  }

  lines.push(
    `protected readonly ɵsx = ɵinstallSxCompiledView(`,
    `  this,`,
    `  ${setupName},`,
  );

  if (sourceReferences.length > 0) {
    lines.push(`  {`);
    lines.push(`    sourceReferences: this.${SX_SOURCE_REFERENCES_FIELD},`);
    lines.push(`  },`);
  }

  lines.push(`);`);
  return lines.join('\n');
}