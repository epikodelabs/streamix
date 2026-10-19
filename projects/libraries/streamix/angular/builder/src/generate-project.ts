import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

// The compiler is a sibling entry point of the same package, imported by its
// published subpath so ng-packagr treats it as an external dependency rather
// than folding its sources into this entry.
import { instrumentStreamixSource } from '@epikodelabs/streamix/angular/compiler';
import { compileSxComponent } from '@epikodelabs/streamix/angular/compiler';
import { installSxLifecycleIntoComponentSource } from '@epikodelabs/streamix/angular/compiler';
import { findSxComponentTemplate, installSxComponentTemplate, virtualRootOf } from './options';

/** Input for one generator pass. */
export interface SxGenerateProjectOptions {
  readonly sourceRoot: string;
  readonly workspaceRoot: string;
  readonly introspection?: boolean;
}

/**
 * Compiles one application source root through the Streamix compiler.
 *
 * Copies the source tree into `.angular/.streamix/<app>/src`, rewrites every
 * component that has an inline template and writes the result — with the
 * compiled setup inlined — back into the virtual tree.
 */
export async function generateProject({
  sourceRoot,
  workspaceRoot,
  introspection = false,
}: SxGenerateProjectOptions): Promise<void> {
  const virtualRoot = virtualRootOf(sourceRoot);
  const sourceDirectory = resolve(workspaceRoot, sourceRoot);
  const outputDirectory = resolve(workspaceRoot, virtualRoot);
  const tsconfigPath = resolve(sourceDirectory, '..', 'tsconfig.app.json');
  const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (tsconfig.error) {
    throw new Error(`Streamix Angular builder could not read ${tsconfigPath}: ` +
      ts.flattenDiagnosticMessageText(tsconfig.error.messageText, '\n'));
  }
  const parsedConfig = ts.parseJsonConfigFileContent(
    tsconfig.config, ts.sys, dirname(tsconfigPath), undefined, tsconfigPath,
  );
  if (parsedConfig.errors.length) {
    throw new Error(`Streamix Angular builder cannot use ${tsconfigPath}:\n` +
      ts.formatDiagnosticsWithColorAndContext(parsedConfig.errors, {
        getCanonicalFileName: path => path, getCurrentDirectory: () => workspaceRoot,
        getNewLine: () => '\n',
      }));
  }
  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
  const checker = program.getTypeChecker();

  /** Only component-owned reactive fields affect template ownership checks.
   * A service or store class in the same file must not make an ordinary
   * templateUrl component fail adoption.
   */
  function decoratedComponents(sourcePath: string): ts.ClassDeclaration[] {
    const source = program.getSourceFile(sourcePath);
    if (!source) return [];
    const result: ts.ClassDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && (ts.getDecorators(node) ?? []).some(decorator => {
        const expression = decorator.expression;
        return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) &&
          expression.expression.text === 'Component';
      })) result.push(node);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return result;
  }

  function componentHasReactiveFields(component: ts.ClassDeclaration): boolean {
    const source = component.getSourceFile();
    const factories = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          if (['atom', 'derived', 'flow', 'scope'].includes((item.propertyName ?? item.name).text))
            factories.add(item.name.text);
        }
      }
    }
    return component.members.some(member => {
      if (!ts.isPropertyDeclaration(member) || !member.initializer) return false;
      const type = checker.getTypeAtLocation(member.initializer);
      if (type.getProperty('type') && type.getProperty('value') &&
          type.getProperty('subscribe')) return true;
      return ts.isCallExpression(member.initializer) &&
        ts.isIdentifier(member.initializer.expression) &&
        factories.has(member.initializer.expression.text);
    });
  }

  // Overwrite in place rather than clearing the directory first: the delegate
  // dev server rebuilds on every change, and a wiped tree would let it compile
  // a half-regenerated project. Stale entries are pruned after a full pass.
  await cp(sourceDirectory, outputDirectory, { recursive: true, force: true });

  async function listFiles(
    directory: string,
    includeAll: boolean,
  ): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) result.push(...await listFiles(path, includeAll));
      else if (
        includeAll ||
        (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
      ) {
        result.push(path);
      }
    }
    return result;
  }

  function standaloneDependencySources(sourcePath: string): string[] {
    const file = program.getSourceFile(sourcePath);
    if (!file) return [];
    const fields: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
        const type = checker.getTypeAtLocation(node.initializer ?? node.name);
        // Streamix sources intentionally carry the `atom` discriminator. A
        // `BehaviorSubject` happens to have `value` and `subscribe`, but its
        // subscription teardown and write API are incompatible with the
        // generated binding table.
        if (
          type.getProperty('type') &&
          type.getProperty('value') &&
          type.getProperty('subscribe')
        ) {
          fields.push(node.name.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return fields;
  }

  /**
   * Fields exposing both `value` and a write method, i.e. atoms a two-way
   * binding can write back.
   */
  function standaloneWritableSources(sourcePath: string): string[] {
    const file = program.getSourceFile(sourcePath);
    if (!file) return [];
    const fields: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
        const type = checker.getTypeAtLocation(node.initializer ?? node.name);
        if (
          type.getProperty('type') &&
          type.getProperty('value') &&
          type.getProperty('set')
        ) {
          fields.push(node.name.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return fields;
  }

  /**
   * Scope members backed by a writable atom. Derived members — arrow
   * functions, `method(...)`, `derivedExpr(...)` — are excluded: `scope.set`
   * throws for them, so a two-way binding must not be compiled.
   */
  function scopeWritablePathsFor(
    sourcePath: string,
  ): Record<string, readonly string[]> | undefined {
    const scopes = scopeMembersFor(sourcePath, property => {
      const initializer = property.initializer;

      if (!initializer) return false;
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        return false;
      }

      if (ts.isCallExpression(initializer)) {
        const name = ts.isIdentifier(initializer.expression)
          ? initializer.expression.text
          : undefined;

        return name !== 'method' && name !== 'derivedExpr' && name !== 'flowExpr';
      }

      return true;
    });

    return scopes;
  }

  /**
   * Scope members declared in `scope({...})` initializers, optionally filtered
   * per member.
   */
  function scopeMembersFor(
    sourcePath: string,
    accept: (property: ts.PropertyAssignment) => boolean = () => true,
  ): Record<string, readonly string[]> | undefined {
    const file = program.getSourceFile(sourcePath);
    if (!file) return undefined;

    const scopes: Record<string, readonly string[]> = {};

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
        const initializer = node.initializer;
        if (
          initializer &&
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          initializer.expression.text === 'scope' &&
          initializer.arguments.length > 0 &&
          ts.isObjectLiteralExpression(initializer.arguments[0])
        ) {
          const members = initializer.arguments[0].properties
            .filter(ts.isPropertyAssignment)
            .filter(accept)
            .map(property =>
              ts.isIdentifier(property.name) ? property.name.text : undefined,
            )
            .filter((name): name is string => !!name);
          if (members.length > 0) {
            scopes[node.name.text] = members;
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(file, visit);
    return Object.keys(scopes).length > 0 ? scopes : undefined;
  }

  function scopeValuePathsFor(
    sourcePath: string,
  ): Record<string, readonly string[]> | undefined {
    return scopeMembersFor(sourcePath);
  }

  /**
   * Writes via a same-directory temporary so the watching bundler always reads
   * either the previous or the new file, never a partial write.
   */
  async function writeFileAtomic(path: string, contents: string): Promise<void> {
    const temporary = `${path}.tmp-${process.pid}`;
    await writeFile(temporary, contents);
    await rename(temporary, path);
  }

  for (const sourcePath of await listFiles(sourceDirectory, false)) {
    const original = program.getSourceFile(sourcePath) ?? ts.createSourceFile(sourcePath, await readFile(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
    const instrumented = instrumentStreamixSource({ file: original, checker,
      sourcePath: relative(workspaceRoot, sourcePath), enabled: introspection });
    let source = rewriteDerivedAtomReads(instrumented);
    if (introspection && relative(sourceDirectory, sourcePath).replace(/\\/g, '/') === 'main.ts') {
      // Enable before bootstrapApplication constructs any component instances.
      source = `import { enableStreamixIntrospection as __sxEnable, mountStreamixInspector as __sxMount } from '@epikodelabs/streamix';\n__sxEnable();\n` + source + '\n__sxMount();\n';
    }
    const relativePath = relative(sourceDirectory, sourcePath).replace(/\\/g, '/');
    const outputPath = resolve(outputDirectory, relativePath);

    // The virtual copy was made before formula normalization. Always persist
    // a derived-read rewrite, including stores/services and components that
    // do not happen to compile a template in this pass.
    if (source !== await readFile(sourcePath, 'utf8')) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFileAtomic(outputPath, source);
    }

    if (!source.includes('@Component')) continue;
    const components = decoratedComponents(sourcePath);
    const hasReactiveComponent = components.some(componentHasReactiveFields);
    if (components.length > 1 && hasReactiveComponent) {
      throw new Error(`[streamix] ${relativePath}: multiple @Component classes with Streamix sources ` +
        'in one file are not supported by this compiler. Split components into separate files.');
    }
    const match = findSxComponentTemplate(source);
    if (!match) {
      if (hasReactiveComponent) {
        throw new Error(
          `[streamix] ${relativePath}: a component with Streamix sources needs a static @Component template or templateUrl. ` +
          'Computed Angular template metadata is not supported.',
        );
      }
      // Ordinary Angular components without adopted Streamix sources are valid.
      continue;
    }
    let templateText: string;
    let templatePath = sourcePath;
    if (match.kind === 'external') {
      const path = resolve(dirname(sourcePath), match.url);
      const withinSource = relative(sourceDirectory, path).replace(/\\/g, '/');
      if (!match.url || /^\w+:/.test(match.url) ||
          withinSource === '..' || withinSource.startsWith('../') ||
          withinSource.startsWith('/') || !path.endsWith('.html')) {
        throw new Error(`[streamix] ${relativePath}: templateUrl ${JSON.stringify(match.url)} must resolve to an HTML file within sourceRoot.`);
      }
      try {
        templateText = await readFile(path, 'utf8');
        templatePath = path;
      } catch (error) {
        throw new Error(`[streamix] ${relativePath}: could not read templateUrl ${JSON.stringify(match.url)}: ${String(error)}`);
      }
    } else {
      templateText = match.template;
    }
    const scopeValuePaths = scopeValuePathsFor(sourcePath);
    const compiled = compileSxComponent({
      componentPath: sourcePath,
      templatePath,
      template: templateText,
      dependencySourcePaths: standaloneDependencySources(sourcePath),
      scopeValuePaths,
      writableSourcePaths: standaloneWritableSources(sourcePath),
      scopeWritablePaths: scopeWritablePathsFor(sourcePath),
    });
    if (!compiled.setupCode && !compiled.lifecycleInitializer) {
      if (scopeValuePaths) {
        console.warn(
          `[streamix] ${relativePath}: declares a scope but compiled no Streamix bindings; ` +
          'copying the component through the virtual layer unchanged.',
        );
      }
      continue;
    }
    const lifecycle = installSxLifecycleIntoComponentSource(source, {
      inlineSetup: compiled.setupCode,
      sourceReferenceFields: compiled.sourceReferenceFields,
    }).source;
    let virtual: string;
    try {
      virtual = installSxComponentTemplate(lifecycle, compiled.transformedTemplate);
    } catch (error) {
      throw new Error(
        `[streamix] ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFileAtomic(outputPath, virtual);
  }

  /**
   * Deletes virtual entries whose source twin is gone: renamed or deleted
   * sources must not linger as stale compilation inputs. Generated setup is
   * now inlined into its component, so legacy `.sx.ts` sidecars are removed.
   */
  async function pruneStaleEntries(): Promise<void> {
    const sourceTwinPaths = new Set(
      (await listFiles(sourceDirectory, true))
        .map(path => relative(sourceDirectory, path).replace(/\\/g, '/')),
    );

    const prune = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          await prune(path);
          continue;
        }
        const virtualPath = relative(outputDirectory, path).replace(/\\/g, '/');
        if (
          virtualPath.endsWith('.sx.ts') ||
          !sourceTwinPaths.has(virtualPath)
        ) {
          await rm(path, { force: true });
        }
      }
    };

    await prune(outputDirectory);
  }

  await pruneStaleEntries();

  // Angular's template compiler requires decorated components to be program
  // roots, not merely transitively imported by a file replacement. Point the
  // delegated build at a virtual tsconfig which includes the entire generated
  // source tree. This keeps consuming projects free from `.angular` paths.
  await writeFile(
    resolve(outputDirectory, '..', 'tsconfig.app.json'),
    `${JSON.stringify({
      extends: configPath(relative(resolve(outputDirectory, '..'), tsconfigPath)),
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    }, null, 2)}\n`,
  );

}

function configPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

/**
 * Lets authored formulas use local atoms as values (`price * quantity`) while
 * preserving raw Streamix atoms as the actual derived dependencies.
 */
export function rewriteDerivedAtomReads(source: string): string {
  const file = ts.createSourceFile('component.ts', source, ts.ScriptTarget.Latest, true);
  const atomNames = new Set<string>();

  const isFactory = (node: ts.Expression, name: string): boolean =>
    ts.isIdentifier(node) && node.text === name;

  const unwrapDebug = (node: ts.Expression): ts.Expression => ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) && node.expression.text.startsWith('__sxDebug') ? node.arguments[0] : node;
  const collectAtoms = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(unwrapDebug(node.initializer)) &&
      isFactory((unwrapDebug(node.initializer) as ts.CallExpression).expression, 'atom')
    ) {
      atomNames.add(node.name.text);
    }
    ts.forEachChild(node, collectAtoms);
  };
  collectAtoms(file);

  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      isFactory(node.expression, 'derived') &&
      node.arguments.length > 0
    ) {
      const callback = node.arguments[0];
      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
        const hasTrackerParameter = callback.parameters.some(parameter =>
          ts.isIdentifier(parameter.name) && parameter.name.text === '$');
        const read = (child: ts.Node): void => {
          // `$` receives source references and records derived dependencies.
          // Rewriting `$(count)` to `$(count.value)` would lose that source.
          if (hasTrackerParameter && ts.isCallExpression(child) &&
              ts.isIdentifier(child.expression) && child.expression.text === '$') return;
          if (
            ts.isPropertyAccessExpression(child) &&
            child.expression.kind === ts.SyntaxKind.ThisKeyword &&
            atomNames.has(child.name.text)
          ) {
            // `this.price.value` is already explicit. Rewriting the inner
            // access would produce `this.price.value.value`.
            if (
              ts.isPropertyAccessExpression(child.parent) &&
              child.parent.expression === child &&
              child.parent.name.text === 'value'
            ) {
              return;
            }
            edits.push({
              start: child.getStart(file),
              end: child.end,
              replacement: `${child.getText(file)}.value`,
            });
            return;
          }
          if (ts.isIdentifier(child) && atomNames.has(child.text)) {
            const parent = child.parent;
            const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === child;
            const isExplicitValue = ts.isPropertyAccessExpression(parent) && parent.expression === child;
            const isShorthand = ts.isShorthandPropertyAssignment(parent);
            if (!isPropertyName && !isExplicitValue && !isShorthand) {
              edits.push({
                start: child.getStart(file),
                end: child.end,
                replacement: `${child.text}.value`,
              });
            }
          }
          ts.forEachChild(child, read);
        };
        read(callback.body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  let transformed = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    transformed = transformed.slice(0, edit.start) + edit.replacement + transformed.slice(edit.end);
  }
  return transformed;
}
