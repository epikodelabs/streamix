import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

// The compiler is a sibling entry point of the same package, imported by its
// published subpath so ng-packagr treats it as an external dependency rather
// than folding its sources into this entry.
import { instrumentStreamixSource } from '@epikodelabs/streamix/angular/compiler';
import { createTokenSourceMap, injectIntrospectionActivation } from '@epikodelabs/streamix/compiler';
import { compileSxComponent } from '@epikodelabs/streamix/angular/compiler';
import { installSxLifecycleIntoComponentSource } from '@epikodelabs/streamix/angular/compiler';
import { findSxComponentTemplate, installSxComponentTemplate, resolveSourceRoot, virtualRootOf } from './options';

/** Factory recognition must look through type-only casts and debug wrappers. */
function unwrapReactiveInitializer(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) &&
        /^__sxDebug_*$/.test(current.expression.text) && current.arguments.length > 0) {
      current = current.arguments[0];
    } else return current;
  }
}

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
  // Validate at the generator boundary too: direct callers (tests, tools)
  // bypass the builder-option layer where resolveSourceRoot normally runs.
  const validatedRoot = resolveSourceRoot({ sourceRoot });
  const virtualRoot = virtualRootOf(validatedRoot);
  const sourceDirectory = resolve(workspaceRoot, validatedRoot);
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
  // Introspection instruments every authored file, including files a narrowed
  // tsconfig does not list as program roots. Include them so the checker knows
  // every node it is asked about; otherwise projects that never import
  // Streamix can crash inside TypeScript while probing unrelated `this` or
  // member expressions.
  const programRoots = [...new Set([
    ...parsedConfig.fileNames,
    ...(introspection ? await listFiles(sourceDirectory, false) : []),
  ])];
  const program = ts.createProgram(programRoots, parsedConfig.options);
  const checker = program.getTypeChecker();

  // Compile into a freshly staged sibling and only then swap: the delegate
  // dev server rebuilds on every change, so a mid-scan failure must leave the
  // previous generation serving untouched instead of a wiped or mixed tree.
  await sweepAbandonedTransactions(outputDirectory);
  const stagingDirectory = join(dirname(outputDirectory), `.${basename(outputDirectory)}-sx-stage-${randomUUID()}`);
  const backupDirectory = join(dirname(outputDirectory), `.${basename(outputDirectory)}-sx-backup-${randomUUID()}`);
  let backedUp = false;
  let installed = false;
  try {
    await compileStagedOutput({
      workspaceRoot, sourceDirectory, outputDirectory: stagingDirectory, program, checker, introspection,
    });
    try {
      await rename(outputDirectory, backupDirectory);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(stagingDirectory, outputDirectory);
    installed = true;
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
  } catch (error) {
    if (backedUp && !installed) await rename(backupDirectory, outputDirectory);
    throw error;
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
    if (installed && backedUp) await rm(backupDirectory, { force: true, recursive: true });
  }
}

/** Deletes staging and backup siblings abandoned by a crashed generation, and
 * restores the last good tree when a crash landed between the swap renames.
 * Only UUID-shaped matches of this builder's own naming are touched. */
async function sweepAbandonedTransactions(output: string): Promise<void> {
  const abandoned = new RegExp(
    `^\\.${basename(output)}-sx-(?:stage|backup)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    'i',
  );
  const leftovers = (await readdir(dirname(output), { withFileTypes: true })
    .catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return [];
    }))
    .filter(entry => abandoned.test(entry.name))
    .map(entry => join(dirname(output), entry.name));
  if (leftovers.length === 0) return;
  const backups = leftovers.filter(path => basename(path).includes('-sx-backup-')).sort();
  let restored = false;
  if (backups.length > 0) {
    try {
      await access(output);
    } catch {
      await rename(backups[0], output);
      restored = true;
    }
  }
  for (const leftover of leftovers) {
    if (restored && leftover === backups[0]) continue;
    await rm(leftover, { force: true, recursive: true });
  }
}

/** Inputs for one staged compile pass over an authored source tree. */
interface SxStagedCompileOptions {
  readonly workspaceRoot: string;
  readonly sourceDirectory: string;
  readonly outputDirectory: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly introspection: boolean;
}

/**
 * Compiles the authored tree into a freshly staged output directory. Every
 * intermediate write lands in the stage; the caller swaps it into the live
 * virtual tree only after this pass has fully succeeded.
 */
async function compileStagedOutput({
  workspaceRoot,
  sourceDirectory,
  outputDirectory,
  program,
  checker,
  introspection,
}: SxStagedCompileOptions): Promise<void> {
  await cp(sourceDirectory, outputDirectory, { recursive: true });

  const entry = introspection ? await findEntry(sourceDirectory) : undefined;
  for (const sourcePath of await listFiles(sourceDirectory, false)) {
    const authored = await readFile(sourcePath, 'utf8');
    const relativePath = relative(sourceDirectory, sourcePath).replace(/\\/g, '/');
    const outputPath = resolve(outputDirectory, relativePath);
    const compiled = await compileVirtualSource({
      workspaceRoot, sourceDirectory, sourcePath, authored, program, checker, introspection,
      activateEntry: entry !== undefined && sourcePath === entry,
    });
    // Always persist a derived-read rewrite, including stores/services and
    // components that do not happen to compile a template in this pass.
    if (compiled.text !== authored) {
      await writeVirtualFile(outputPath, compiled.text, authored, relative(workspaceRoot, sourcePath));
    }
  }

  /**
   * A fresh stage cannot hold stale twins, but legacy generated `.sx.ts`
   * sidecars copied from the authored tree must still not reach the virtual
   * compilation inputs. Builder-written `.map` siblings are generated output,
   * not twins, and stay.
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
          (!virtualPath.endsWith('.map') && !sourceTwinPaths.has(virtualPath))
        ) {
          await rm(path, { force: true });
        }
      }
    };

    await prune(outputDirectory);
  }

  await pruneStaleEntries();
}

/** Only component-owned reactive fields affect template ownership checks.
 * A service or store class in the same file must not make an ordinary
 * templateUrl component fail adoption.
 */
function decoratedComponents(program: ts.Program, sourcePath: string): ts.ClassDeclaration[] {
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

function componentHasReactiveFields(checker: ts.TypeChecker, component: ts.ClassDeclaration): boolean {
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
    const initializer = unwrapReactiveInitializer(member.initializer);
    return ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      factories.has(initializer.expression.text);
  });
}

function standaloneDependencySources(program: ts.Program, checker: ts.TypeChecker, sourcePath: string): string[] {
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
function standaloneWritableSources(program: ts.Program, checker: ts.TypeChecker, sourcePath: string): string[] {
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
  program: ts.Program,
  sourcePath: string,
): Record<string, readonly string[]> | undefined {
  const scopes = scopeMembersFor(program, sourcePath, property => {
    const initializer = property.initializer ? unwrapReactiveInitializer(property.initializer) : undefined;

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
  program: ts.Program,
  sourcePath: string,
  accept: (property: ts.PropertyAssignment) => boolean = () => true,
): Record<string, readonly string[]> | undefined {
  const file = program.getSourceFile(sourcePath);
  if (!file) return undefined;

  const scopes: Record<string, readonly string[]> = {};

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer ? unwrapReactiveInitializer(node.initializer) : undefined;
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
  program: ts.Program,
  sourcePath: string,
): Record<string, readonly string[]> | undefined {
  return scopeMembersFor(program, sourcePath);
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

/** Writes the virtual text with an authored-position source map trailer, so
 * the esbuild delegate chains devtools back onto the authored file. Generated
 * bindings and instrumentation inserts stay unmapped, matching the React
 * builder's maps. */
async function writeVirtualFile(path: string, text: string, authored: string, fileName: string): Promise<void> {
  const map = createTokenSourceMap(authored, text, fileName.replace(/\\/g, '/'));
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${text}\n//# sourceMappingURL=${basename(path)}.map\n`);
  await writeFileAtomic(`${path}.map`, `${JSON.stringify(map)}\n`);
}

/** One authored file compiled into its virtual text. The staged pass and the
 * per-file watch path share this pipeline so both produce identical output. */
async function compileVirtualSource({
  workspaceRoot,
  sourceDirectory,
  sourcePath,
  authored,
  program,
  checker,
  introspection,
  activateEntry,
}: {
  workspaceRoot: string;
  sourceDirectory: string;
  sourcePath: string;
  authored: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  introspection: boolean;
  activateEntry: boolean;
}): Promise<{ text: string }> {
  const original = program.getSourceFile(sourcePath) ?? ts.createSourceFile(sourcePath, authored, ts.ScriptTarget.Latest, true);
  const instrumented = instrumentStreamixSource({ file: original, checker,
    sourcePath: relative(workspaceRoot, sourcePath), enabled: introspection });
  let source = rewriteDerivedAtomReads(instrumented);
  if (introspection && activateEntry) {
    // Enable before bootstrapApplication constructs any component instances.
    source = injectIntrospectionActivation(source);
  }
  const relativePath = relative(sourceDirectory, sourcePath).replace(/\\/g, '/');

  if (!source.includes('@Component')) {
    return { text: source };
  }
  const components = decoratedComponents(program, sourcePath);
  const hasReactiveComponent = components.some(component => componentHasReactiveFields(checker, component));
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
    return { text: source };
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
  const scopeValuePaths = scopeValuePathsFor(program, sourcePath);
  const compiled = compileSxComponent({
    componentPath: sourcePath,
    templatePath,
    template: templateText,
    dependencySourcePaths: standaloneDependencySources(program, checker, sourcePath),
    scopeValuePaths,
    writableSourcePaths: standaloneWritableSources(program, checker, sourcePath),
    scopeWritablePaths: scopeWritablePathsFor(program, sourcePath),
  });
  if (!compiled.setupCode && !compiled.lifecycleInitializer) {
    if (scopeValuePaths) {
      console.warn(
        `[streamix] ${relativePath}: declares a scope but compiled no Streamix bindings; ` +
        'copying the component through the virtual layer unchanged.',
      );
    }
    return { text: source };
  }
  const lifecycle = installSxLifecycleIntoComponentSource(source, {
    inlineSetup: compiled.setupCode,
    sourceReferenceFields: compiled.sourceReferenceFields,
  }).source;
  try {
    return { text: installSxComponentTemplate(lifecycle, compiled.transformedTemplate) };
  } catch (error) {
    throw new Error(
      `[streamix] ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Semantic program over the app tsconfig with edited files overlaid, so a
 * watch edit is analyzed exactly as authored rather than from a stale disk
 * read. TypeScript may ask for the same file more than once; returning a
 * fresh SourceFile each time splits the nodes and symbols across instances
 * and corrupts the checker, so overlay texts are cached by normalized path. */
function createOverlayProgram(
  rootNames: readonly string[],
  options: ts.CompilerOptions,
  overlays: ReadonlyMap<string, string>,
): ts.Program {
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile?.bind(host);
  const fileExists = host.fileExists.bind(host);
  const overlayFor = (fileName: string): string | undefined => {
    const direct = overlays.get(fileName);
    if (direct !== undefined) return direct;
    const wanted = fileName.replace(/\\/g, '/').toLowerCase();
    for (const [key, value] of overlays) {
      if (key.replace(/\\/g, '/').toLowerCase() === wanted) return value;
    }
    return undefined;
  };
  const overlaySources = new Map<string, ts.SourceFile>();
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = overlayFor(fileName);
    if (text === undefined) return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    const key = fileName.replace(/\\/g, '/').toLowerCase();
    let source = overlaySources.get(key);
    if (!source) {
      source = ts.createSourceFile(fileName, text, languageVersion, true);
      overlaySources.set(key, source);
    }
    return source;
  };
  host.readFile = fileName => overlayFor(fileName) ?? readFile?.(fileName);
  host.fileExists = fileName => overlayFor(fileName) !== undefined || fileExists(fileName);
  return ts.createProgram({ rootNames: [...rootNames], options, host });
}

/** Synchronize an authored source change into the delegated virtual project. */
export async function regenerateAngularFile(workspaceRoot: string, sourceRoot: string, changedPath: string, introspection = false): Promise<void> {
  const validatedRoot = resolveSourceRoot({ sourceRoot });
  const sourceDirectory = resolve(workspaceRoot, validatedRoot);
  const outputDirectory = resolve(workspaceRoot, virtualRootOf(validatedRoot));
  const normalized = changedPath.replace(/\\/g, '/');
  if (!normalized || isAbsolute(normalized) || win32.isAbsolute(normalized) ||
      normalized.split('/').some(part => part === '..' || part === '.')) return;
  const origin = join(sourceDirectory, normalized);
  const destination = join(outputDirectory, normalized);
  let authored: string;
  try {
    authored = await readFile(origin, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EISDIR') return;
    if (code !== 'ENOENT') throw error;
    await rm(destination, { force: true, recursive: true });
    await rm(`${destination}.map`, { force: true });
    return;
  }
  if (normalized.endsWith('.html')) {
    // A template edit can affect every component that references it through
    // templateUrl; the cheap safe route is a full staged regeneration.
    await generateProject({ sourceRoot: validatedRoot, workspaceRoot, introspection });
    return;
  }
  if (!/\.[jt]sx?$/i.test(normalized) || /\.(?:d|spec|test)\.[jt]sx?$/i.test(normalized)) {
    // Assets and spec files are mirrored verbatim, like the staged copy.
    await mkdir(dirname(destination), { recursive: true });
    await writeFileAtomic(destination, authored);
    return;
  }

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
  const programRoots = [...new Set([
    ...parsedConfig.fileNames,
    ...(introspection ? await listFiles(sourceDirectory, false) : []),
  ])];
  const program = createOverlayProgram(programRoots, parsedConfig.options, new Map([[origin, authored]]));
  const checker = program.getTypeChecker();
  const compiled = await compileVirtualSource({
    workspaceRoot, sourceDirectory, sourcePath: origin, authored, program, checker, introspection,
    activateEntry: ENTRY_NAMES.includes(basename(normalized).toLowerCase()),
  });
  await writeVirtualFile(destination, compiled.text, authored, relative(workspaceRoot, origin));
}

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

function configPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

const ENTRY_NAMES = ['main.tsx', 'main.jsx', 'main.ts', 'main.js', 'index.tsx', 'index.jsx', 'index.ts', 'index.js'];

/** The bootstrap module the delegate bundles, at the root or under src/. */
async function findEntry(root: string): Promise<string | undefined> {
  for (const directory of [join(root, 'src'), root]) {
    for (const name of ENTRY_NAMES) {
      const path = join(directory, name);
      try {
        await readFile(path);
        return path;
      } catch { /* not this one */ }
    }
  }
  return undefined;
}

/**
 * Lets authored formulas use local atoms as values (`price * quantity`) while
 * preserving raw Streamix atoms as the actual derived dependencies.
 */
export function rewriteDerivedAtomReads(source: string): string {
  const file = ts.createSourceFile('component.ts', source, ts.ScriptTarget.Latest, true);
  // Bind the authored file so lexical locals and each class's fields have
  // distinct identities. No module or library resolution is needed here.
  const host = ts.createCompilerHost({ noLib: true, noResolve: true });
  host.getSourceFile = name => name === file.fileName ? file : undefined;
  const checker = ts.createProgram([file.fileName], { noLib: true, noResolve: true }, host).getTypeChecker();
  const atoms = new Set<ts.Symbol>();
  const factories = new Map<ts.Symbol, string>();
  const namespaces = new Set<ts.Symbol>();
  const factoryNames = new Set(['atom', 'derived', 'flow']);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text) ||
        statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        const symbol = checker.getSymbolAtLocation(item.name);
        if (symbol && !item.isTypeOnly) factories.set(symbol, (item.propertyName ?? item.name).text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      const symbol = checker.getSymbolAtLocation(bindings.name);
      if (symbol) namespaces.add(symbol);
    }
  }
  const factoryKind = (node: ts.Expression): string | undefined => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      // Bare factory names remain supported for snippets without imports.
      return symbol ? factories.get(symbol) : factoryNames.has(node.text) ? node.text : undefined;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol && namespaces.has(symbol)) return node.name.text;
    }
    return undefined;
  };

  const collectAtoms = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(unwrapReactiveInitializer(node.initializer)) &&
      factoryNames.has(factoryKind((unwrapReactiveInitializer(node.initializer) as ts.CallExpression).expression) ?? '')
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) atoms.add(symbol);
    }
    ts.forEachChild(node, collectAtoms);
  };
  collectAtoms(file);

  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      factoryKind(node.expression) === 'derived' &&
      node.arguments.length > 0
    ) {
      const callback = node.arguments[0];
      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
        const trackers = new Set(callback.parameters.flatMap(parameter =>
          ts.isIdentifier(parameter.name) ? [checker.getSymbolAtLocation(parameter.name)] : []));
        const read = (child: ts.Node): void => {
          if (ts.isTypeNode(child)) return;
          // Nested formulas get their own pass below, avoiding overlapping edits.
          if (ts.isCallExpression(child) && factoryKind(child.expression) === 'derived') return;
          // Explicit tracker calls consume sources, whatever the reader's name.
          if (ts.isCallExpression(child)) {
            const callee = child.expression;
            const reader = ts.isPropertyAccessExpression(callee) &&
              ['read', 'use'].includes(callee.name.text) ? callee.expression : callee;
            if (ts.isIdentifier(reader) && trackers.has(checker.getSymbolAtLocation(reader))) return;
          }
          if (
            ts.isPropertyAccessExpression(child) &&
            child.expression.kind === ts.SyntaxKind.ThisKeyword &&
            atoms.has(checker.getSymbolAtLocation(child.name)!)
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
          if (ts.isIdentifier(child)) {
            const parent = child.parent;
            const isShorthand = ts.isShorthandPropertyAssignment(parent);
            const symbol = isShorthand ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(child);
            if (!symbol || !atoms.has(symbol)) return;
            const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === child;
            const isExplicitValue = ts.isPropertyAccessExpression(parent) && parent.expression === child && parent.name.text === 'value';
            const isDeclaration = (ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
              ts.isBindingElement(parent) || ts.isPropertyAssignment(parent)) && parent.name === child;
            if (!isPropertyName && !isExplicitValue && !isDeclaration) {
              edits.push({
                start: child.getStart(file),
                end: child.end,
                replacement: isShorthand ? `${child.text}: ${child.text}.value` : `${child.text}.value`,
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
