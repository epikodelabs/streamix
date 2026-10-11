import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

// The compiler is a sibling entry point of the same package, imported by its
// published subpath so ng-packagr treats it as an external dependency rather
// than folding its sources into this entry.
import { compileSxComponent } from '@epikodelabs/streamix/angular/compiler';
import { installSxLifecycleIntoComponentSource } from '@epikodelabs/streamix/angular/compiler';
import { installTransformedTemplate, virtualRootOf } from './options';

/** Input for one generator pass. */
export interface SxGenerateProjectOptions {
  readonly sourceRoot: string;
  readonly workspaceRoot: string;
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
}: SxGenerateProjectOptions): Promise<void> {
  const virtualRoot = virtualRootOf(sourceRoot);
  const sourceDirectory = resolve(workspaceRoot, sourceRoot);
  const outputDirectory = resolve(workspaceRoot, virtualRoot);
  const tsconfigPath = resolve(sourceDirectory, '..', 'tsconfig.app.json');
  const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    tsconfig.config,
    ts.sys,
    dirname(tsconfigPath),
  );
  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
  const checker = program.getTypeChecker();

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
    const source = rewriteDerivedAtomReads(await readFile(sourcePath, 'utf8'));
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
    const match = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source);
    if (!match) {
      console.warn(
        `[streamix] ${relativePath}: no inline template followed by styles was found; ` +
        'copying the component through the virtual layer unchanged.',
      );
      continue;
    }
    const scopeValuePaths = scopeValuePathsFor(sourcePath);
    const compiled = compileSxComponent({
      componentPath: sourcePath,
      template: match[1],
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
      virtual = installTransformedTemplate(lifecycle, compiled.transformedTemplate);
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

  const collectAtoms = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isFactory(node.initializer.expression, 'atom')
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
        const read = (child: ts.Node): void => {
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
