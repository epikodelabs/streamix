import type {
  ParsedSxTemplate,
} from './angular-template-parser';
import {
  emitComponentSetup,
} from './emit-component-setup';

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
    `  ɵsxTextExpression,`,
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
export function emitLifecycleInitializer(
  setupName = 'ɵsetupSxBindings',
): string {
  return [
    `protected readonly ɵsx = ɵinstallSxCompiledView(`,
    `  this,`,
    `  ${setupName},`,
    `);`,
  ].join('\n');
}
