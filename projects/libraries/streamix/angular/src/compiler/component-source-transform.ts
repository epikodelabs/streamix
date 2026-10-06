import {
  SX_SETUP_RUNTIME_SYMBOLS,
  emitLifecycleInitializer,
  emitSourceReferenceInitializer,
} from './emit-component-module';
import { SX_SOURCE_REFERENCES_FIELD } from './generated-names';

export interface SxComponentSourceTransformOptions {
  /**
   * Generated setup function, inlined into the component module so the
   * component never imports a generated file.
   */
  readonly inlineSetup?: string;
  readonly setupName?: string;
  readonly runtimeImport?: string;
  readonly sourceReferenceFields?: readonly string[];
  readonly requiresAngularInvalidation?: boolean;
}

export interface SxComponentSourceTransformResult {
  readonly source: string;
  readonly changed: boolean;
}

/**
 * Adds generated sx runtime imports and component initializers to a
 * conventional Angular component class.
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
  const sourceReferences = options.sourceReferenceFields ?? [];
  const hasSetup = !!options.inlineSetup;

  if (!hasSetup && sourceReferences.length === 0) {
    return { source, changed: false };
  }

  if (
    source.includes('ɵinstallSxCompiledView(') ||
    source.includes('ɵinstallSxSourceReferences(') ||
    (hasSetup && source.includes(`function ${setupName}(`))
  ) {
    return {
      source,
      changed: false,
    };
  }

  const classMatch =
    /export\s+class\s+[A-Za-z_$][\w$]*\s*(?:extends\s+[^{]+)?(?:implements\s+[^{]+)?\{/m.exec(source);

  if (!classMatch || classMatch.index == null) {
    throw new Error(
      'Unable to install sx lifecycle: no conventional exported component class was found.',
    );
  }

  const runtimeSymbols: string[] = [];
  if (hasSetup) {
    runtimeSymbols.push('ɵinstallSxCompiledView');
  }
  if (sourceReferences.length > 0) {
    runtimeSymbols.push('ɵinstallSxSourceReferences');
  }

  const imports = [
    `import { ${[
      ...runtimeSymbols,
      ...(hasSetup ? runtimeSymbolsForSetup(options.inlineSetup!) : []),
    ].join(', ')} } from ${JSON.stringify(runtimeImport)};`,
    ``,
  ].join('\n');

  const openBrace =
    classMatch.index + classMatch[0].lastIndexOf('{');
  const insertion = findMatchingClassBrace(source, openBrace);

  if (insertion < 0) {
    throw new Error(
      'Unable to install sx lifecycle: component class closing brace was not found.',
    );
  }

  if (
    sourceReferences.length > 0 &&
    classBodyUsesGeneratedMember(
      source,
      openBrace,
      insertion,
      SX_SOURCE_REFERENCES_FIELD,
    )
  ) {
    throw new Error(
      `Unable to install sx lifecycle: component member ${SX_SOURCE_REFERENCES_FIELD} is reserved for generated Streamix source references.`,
    );
  }

  const generated = hasSetup
    ? emitLifecycleInitializer(
        setupName,
        {
          sourceReferences,
          angularInvalidation: options.requiresAngularInvalidation,
        },
      )
    : emitSourceReferenceInitializer(sourceReferences);

  // Generated fields go at the end of the class so authored instance fields
  // already exist when the source-reference bridge installs its accessors.
  const initializer = `\n${generated
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')}\n`;

  const withInitializer =
    imports +
    source.slice(0, insertion) +
    initializer +
    source.slice(insertion);

  return {
    // The setup function is a hoisted declaration, so appending it after the
    // class keeps the component self-contained without a generated import.
    source: hasSetup
      ? `${withInitializer}\n${options.inlineSetup}\n`
      : withInitializer,
    changed: true,
  };
}

/** Includes only primitives referenced by this setup, preserving noUnusedLocals. */
function runtimeSymbolsForSetup(setup: string): readonly string[] {
  return SX_SETUP_RUNTIME_SYMBOLS.filter(symbol =>
    new RegExp(
      `(^|[^A-Za-z0-9_$])${escapeRegExp(symbol)}(?![A-Za-z0-9_$])`,
    ).test(setup),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classBodyUsesGeneratedMember(
  source: string,
  openBrace: number,
  closeBrace: number,
  member: string,
): boolean {
  let depth = 0;
  let quote: '"' | "'" | '`' | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBrace; index < closeBrace; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      continue;
    }

    if (
      depth === 1 &&
      (/[A-Za-z_$]/.test(char))
    ) {
      let end = index + 1;
      while (end < closeBrace && /[\w$]/.test(source[end])) {
        end += 1;
      }

      if (source.slice(index, end) === member) {
        return true;
      }

      index = end - 1;
    }
  }

  return false;
}

function findMatchingClassBrace(
  source: string,
  openBrace: number,
): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
