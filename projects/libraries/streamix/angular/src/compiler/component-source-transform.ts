import {
  emitLifecycleInitializer,
} from './emit-component-module';

export interface SxComponentSourceTransformOptions {
  readonly setupImportPath: string;
  readonly setupName?: string;
  readonly runtimeImport?: string;
}

export interface SxComponentSourceTransformResult {
  readonly source: string;
  readonly changed: boolean;
}

/**
 * Adds the generated sx lifecycle imports and initializer to a conventional
 * Angular component class.
 *
 * This helper is intentionally conservative. It refuses ambiguous source
 * shapes instead of trying to become a general TypeScript rewriter. A real
 * builder adapter can later replace this function with a TypeScript-AST
 * transform while preserving the same generated-code contract.
 */
export function installSxLifecycleIntoComponentSource(
  source: string,
  options: SxComponentSourceTransformOptions,
): SxComponentSourceTransformResult {
  const setupName = options.setupName ?? 'ɵsetupSxBindings';
  const runtimeImport =
    options.runtimeImport ?? '@epikodelabs/streamix/angular';

  if (
    source.includes('ɵinstallSxCompiledView(') ||
    source.includes(`import { ${setupName} }`)
  ) {
    return {
      source,
      changed: false,
    };
  }

  const classMatch =
    /export\s+class\s+[A-Za-z_$][\w$]*\s*(?:extends\s+[^{]+)?\{/m.exec(source);

  if (!classMatch || classMatch.index == null) {
    throw new Error(
      'Unable to install sx lifecycle: no conventional exported component class was found.',
    );
  }

  const imports = [
    `import { ɵinstallSxCompiledView } from ${JSON.stringify(runtimeImport)};`,
    `import { ${setupName} } from ${JSON.stringify(options.setupImportPath)};`,
    ``,
  ].join('\n');

  const insertion =
    classMatch.index + classMatch[0].length;

  // One source of truth for the initializer: the emit-component-module
  // helper the build adapter also uses, re-indented for the class body.
  const initializer = `\n${emitLifecycleInitializer(setupName)
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')}`;

  return {
    source:
      imports +
      source.slice(0, insertion) +
      initializer +
      source.slice(insertion),
    changed: true,
  };
}
