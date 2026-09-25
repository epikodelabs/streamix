import type {
  ParsedSxTemplate,
} from './angular-template-parser';
import {
  emitComponentSetup,
} from './emit-component-setup';
import { SX_SOURCE_REFERENCES_FIELD } from './generated-names';

export interface SxComponentModuleOptions {
  readonly runtimeImport?: string;
  readonly setupName?: string;
}

const DEFAULT_RUNTIME_IMPORT = '@epikodelabs/streamix/angular';

/**
 * Emits the runtime import header shared by every generated setup module.
 */
export function emitRuntimeImportHeader(
  runtimeImport: string = DEFAULT_RUNTIME_IMPORT,
): string {
  return [
    `import {`,
    `  createBindingTable,`,
    `  ɵsxAttribute,`,
    `  ɵsxClass,`,
    `  ɵsxInvalidate,`,
    `  ɵsxProperty,`,
    `  ɵsxStyle,`,
    `  ɵsxText,`,
    `  ɵsxTextNode,`,
    `  ɵsxTextExpression,`,
    `  ɵsxTextExpressionNode,`,
    `} from ${JSON.stringify(runtimeImport)};`,
  ].join('\n');
}

/**
 * Emits a complete generated module containing the direct binding setup.
 *
 * The setup module imports only the compiler/runtime primitives required by
 * generated code. The component source can import its setup function and call
 * `ɵinstallSxCompiledView(this, setup)`.
 */
export function emitComponentModule(
  parsed: ParsedSxTemplate,
  options: SxComponentModuleOptions = {},
): string {
  const setupName =
    options.setupName ?? 'ɵsetupSxBindings';

  return [
    emitRuntimeImportHeader(options.runtimeImport),
    ``,
    emitComponentSetup(parsed, setupName),
    ``,
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
