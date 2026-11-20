import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

// The compiler is a sibling entry point of the same package, imported by its
// published subpath so ng-packagr treats it as an external dependency rather
// than folding its sources into this entry.
import { instrumentStreamixSource } from '@epikodelabs/streamix/angular/compiler';
import { createStreamixProgram, createTokenSourceMap, injectIntrospectionActivation } from '@epikodelabs/streamix/compiler';
import { compileSxComponent } from '@epikodelabs/streamix/angular/compiler';
import { installSxLifecycleIntoComponentSource } from '@epikodelabs/streamix/angular/compiler';
import { findSxComponentTemplate, installSxComponentTemplate, resolveSourceRoot, virtualRootOf } from './options';

/** Factory recognition must look through type-only casts and debug wrappers. */
function unwrapReactiveInitializer(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
        ts.isSatisfiesExpression(current)) {
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
  let swapped = false;
  let committed = false;
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
    swapped = true;
    // Angular's template compiler requires decorated components to be program
    // roots, not merely transitively imported by a file replacement. Point the
    // delegated build at a virtual tsconfig which includes the entire generated
    // source tree. This keeps consuming projects free from `.angular` paths.
    // The config belongs to the generation: install it atomically after the
    // swap, and treat any failure until here as uncommitted so the previous
    // tree is restored instead of serving new sources with the old config.
    await writeFileAtomic(
      resolve(outputDirectory, '..', 'tsconfig.app.json'),
      `${JSON.stringify({
        extends: configPath(relative(resolve(outputDirectory, '..'), tsconfigPath)),
        // Both the virtual app and imported workspace sources belong to the program.
        compilerOptions: { rootDir: configPath(relative(dirname(outputDirectory), workspaceRoot)) },
        files: [],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.spec.ts'],
      }, null, 2)}\n`,
    );
    committed = true;
  } catch (error) {
    if (backedUp) {
      // Discard the uncommitted tree (it may have replaced the live one) and
      // put the last committed generation back, byte for byte.
      if (swapped) await rm(outputDirectory, { force: true, recursive: true });
      await rename(backupDirectory, outputDirectory);
      backedUp = false;
    }
    throw error;
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
    if (committed && backedUp) await rm(backupDirectory, { force: true, recursive: true });
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

function standaloneDependencySources(program: ts.Program, checker: ts.TypeChecker, sourcePath: string) {
  const file = program.getSourceFile(sourcePath);
  if (!file) return undefined;
  const fields = new Map<string, ts.Type>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const type = checker.getTypeAtLocation(node.initializer ?? node.name);
      // Streamix sources intentionally carry the `atom` discriminator. A
      // `BehaviorSubject` happens to have `value` and `subscribe`, but its
      // subscription teardown and write API are incompatible with the
      // generated binding table.
      const valueProperty = type.getProperty('value');
      if (
        type.getProperty('type') &&
        valueProperty &&
        type.getProperty('subscribe')
      ) {
        fields.set(node.name.text, checker.getTypeOfSymbolAtLocation(valueProperty, node));
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return Object.assign((path: string) => fields.has(path) ? path : undefined, {
    hasValueMember: (path: string, member: string) => fields.get(path)?.getProperty(member) !== undefined,
  });
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
  return scopeMembersFor(program, sourcePath, initializer => {
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      return false;
    }

    if (ts.isCallExpression(initializer)) {
      const name = ts.isIdentifier(initializer.expression)
        ? initializer.expression.text
        : undefined;

      return name !== 'derivedExpr' && name !== 'flowExpr';
    }

    return true;
  });
}

interface ScopeMemberHelperAliases {
  readonly method: ReadonlySet<string>;
  readonly scope: ReadonlySet<string>;
}

/** Namespace imports of the Streamix package. */
function streamixNamespaceAliases(file: ts.SourceFile): ReadonlySet<string> {
  const namespaces = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  return namespaces;
}

interface ComponentScopeCreation {
  readonly field: string;
  readonly call: ts.CallExpression;
  /**
   * True when the assignment runs before the compiled view mounts
   * (`ngAfterViewInit`): field initializers, constructors, and the
   * `ngOnChanges`/`ngOnInit` hooks. Template member paths are only safe for
   * these; destruction ownership applies to every creation.
   */
  readonly beforeView: boolean;
}

/**
 * Component-owned `scope(...)` creations in one source file.
 *
 * Recognizes field initializers, direct `this.field = scope(...)` assignments,
 * and assignments of a scope held in a local variable. Only instance members
 * of decorated components are component-owned; module-level and static scopes
 * have a wider lifetime and must not be disposed with one component.
 */
function componentScopeCreations(
  program: ts.Program,
  sourcePath: string,
): ComponentScopeCreation[] {
  const file = program.getSourceFile(sourcePath);
  if (!file) return [];

  const aliases = streamixMemberHelperAliases(file);
  const namespaces = streamixNamespaceAliases(file);
  const creations: ComponentScopeCreation[] = [];

  const scopeCall = (expression: ts.Expression | undefined): ts.CallExpression | undefined => {
    if (!expression) return undefined;
    const value = unwrapReactiveInitializer(expression);
    if (!ts.isCallExpression(value)) return undefined;
    const callee = value.expression;
    const isScope = ts.isIdentifier(callee)
      ? aliases.scope.has(callee.text)
      : ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        namespaces.has(callee.expression.text) &&
        callee.name.text === 'scope';
    return isScope ? value : undefined;
  };

  const isStatic = (node: ts.ClassElement): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false);

  const collectFromBody = (body: ts.Node, beforeView: boolean): void => {
    // Locals that currently hold a scope. Name-based tracking is deliberate:
    // a false positive only adds a field to the destroy-time read, where the
    // runtime skips anything without a disposer.
    const scopeLocals = new Map<string, ts.CallExpression>();

    const visit = (node: ts.Node): void => {
      // `this` inside a plain function or nested class is not the component.
      // Arrow functions keep the surrounding `this` and are traversed.
      if (node !== body && (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) ||
          ts.isClassLike(node) || ts.isMethodDeclaration(node))) return;

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const call = scopeCall(node.initializer);
        if (call) scopeLocals.set(node.name.text, call);
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const right = unwrapReactiveInitializer(node.right);
        const created = scopeCall(node.right) ??
          (ts.isIdentifier(right) ? scopeLocals.get(right.text) : undefined);

        if (created) {
          if (ts.isIdentifier(node.left)) {
            scopeLocals.set(node.left.text, created);
          } else if (
            ts.isPropertyAccessExpression(node.left) &&
            node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
            ts.isIdentifier(node.left.name)
          ) {
            creations.push({ field: node.left.name.text, call: created, beforeView });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(body);
  };

  for (const component of decoratedComponents(program, sourcePath)) {
    for (const member of component.members) {
      if (isStatic(member)) continue;

      if (ts.isPropertyDeclaration(member)) {
        if (ts.isIdentifier(member.name)) {
          const call = scopeCall(member.initializer);
          if (call) creations.push({ field: member.name.text, call, beforeView: true });
        }
        continue;
      }

      if (ts.isConstructorDeclaration(member) && member.body) {
        collectFromBody(member.body, true);
        continue;
      }

      if ((ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)) && member.body) {
        const name = ts.isIdentifier(member.name) ? member.name.text : undefined;
        const beforeView = name === 'ngOnChanges' || name === 'ngOnInit';
        collectFromBody(member.body, beforeView);
      }
    }
  }

  return creations;
}

/** Component class fields that can hold a component-owned `scope(...)`. */
function scopeFieldsFor(program: ts.Program, sourcePath: string): string[] {
  return [
    ...new Set(componentScopeCreations(program, sourcePath).map(creation => creation.field)),
  ];
}

/** Local names imported from Streamix for `method(...)` and `scope(...)`. */
function streamixMemberHelperAliases(file: ts.SourceFile): ScopeMemberHelperAliases {
  const method = new Set<string>(['method']);
  const scope = new Set<string>(['scope']);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      const imported = (item.propertyName ?? item.name).text;
      if (imported === 'method') method.add(item.name.text);
      if (imported === 'scope') scope.add(item.name.text);
    }
  }
  return { method, scope };
}

function isMethodMember(
  initializer: ts.Expression,
  aliases: ScopeMemberHelperAliases,
): boolean {
  return ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) &&
    aliases.method.has(initializer.expression.text);
}

/** An explicit `scope(...)` member, including factory forms. */
function isNestedScopeCall(
  initializer: ts.Expression,
  aliases: ScopeMemberHelperAliases,
): boolean {
  return ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) &&
    aliases.scope.has(initializer.expression.text);
}

/**
 * Flattens the statically known value paths of one scope definition. Nested
 * object literals and explicit `scope({...})` members are nested scopes, so
 * their atom leaves are reported as dotted paths; `method(...)` members are
 * callables and are never reported as sources.
 */
function flattenScopeMembers(
  literal: ts.ObjectLiteralExpression,
  prefix: readonly string[],
  aliases: ScopeMemberHelperAliases,
  accept: (initializer: ts.Expression) => boolean,
): string[] {
  const members: string[] = [];

  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) continue;

    const name = property.name.text;
    const initializer = unwrapReactiveInitializer(property.initializer);

    if (isMethodMember(initializer, aliases)) continue;

    if (isNestedScopeCall(initializer, aliases)) {
      const argument = (initializer as ts.CallExpression).arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        members.push(...flattenScopeMembers(
          argument,
          [...prefix, name],
          aliases,
          accept,
        ));
      }
      continue;
    }

    if (ts.isObjectLiteralExpression(initializer)) {
      members.push(...flattenScopeMembers(
        initializer,
        [...prefix, name],
        aliases,
        accept,
      ));
      continue;
    }

    if (!accept(initializer)) continue;
    members.push([...prefix, name].join('.'));
  }

  return members;
}

/**
 * Scope members declared in `scope({...})` creations that run before the
 * compiled view mounts, optionally filtered per value member. Nested scopes
 * are flattened into dotted value paths.
 */
function scopeMembersFor(
  program: ts.Program,
  sourcePath: string,
  accept: (initializer: ts.Expression) => boolean = () => true,
): Record<string, readonly string[]> | undefined {
  const file = program.getSourceFile(sourcePath);
  if (!file) return undefined;

  const aliases = streamixMemberHelperAliases(file);
  const scopes: Record<string, string[]> = {};

  for (const creation of componentScopeCreations(program, sourcePath)) {
    if (!creation.beforeView) continue;
    const argument = creation.call.arguments[0];
    if (!argument || !ts.isObjectLiteralExpression(argument)) continue;

    const members = flattenScopeMembers(argument, [], aliases, accept);
    if (members.length === 0) continue;

    scopes[creation.field] = [
      ...new Set([...(scopes[creation.field] ?? []), ...members]),
    ];
  }

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
async function writeFileAtomic(path: string, contents: string | Buffer): Promise<void> {
  const temporary = `${path}.sx-tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Atomically replaces a virtual file only when its bytes changed. */
async function writeIfChanged(path: string, contents: string | Buffer): Promise<void> {
  try {
    const current = await readFile(path);
    if (current.equals(typeof contents === 'string' ? Buffer.from(contents) : contents)) return;
  } catch {
    // Missing or unreadable: write it.
  }
  await writeFileAtomic(path, contents);
}

/** Writes the virtual text with an authored-position source map trailer, so
 * the esbuild delegate chains devtools back onto the authored file. Generated
 * bindings and instrumentation inserts stay unmapped, matching the React
 * builder's maps. */
async function writeVirtualFile(path: string, text: string, authored: string, fileName: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (text === authored) {
    // Identity compilations stay as the copied authored file, exactly like a
    // staged generation; only a stale map from an earlier rewrite is removed.
    await writeIfChanged(path, authored);
    await rm(`${path}.map`, { force: true });
    return;
  }
  const map = createTokenSourceMap(authored, text, fileName.replace(/\\/g, '/'));
  // Unchanged watch output must not touch the delegated tree; the delegate's
  // watcher would otherwise rebuild files whose generated text did not change.
  await writeIfChanged(path, `${text}\n//# sourceMappingURL=${basename(path)}.map\n`);
  await writeIfChanged(`${path}.map`, `${JSON.stringify(map)}\n`);
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
  let source = rewriteDerivedAtomReads(instrumented, relative(workspaceRoot, sourcePath));
  if (introspection && activateEntry) {
    // Enable before bootstrapApplication constructs any component instances.
    source = injectIntrospectionActivation(source, sourcePath);
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
  const ownedScopeFields = scopeFieldsFor(program, sourcePath);
  const match = findSxComponentTemplate(source);
  if (!match) {
    if (ownedScopeFields.length > 0) {
      // Scope ownership does not depend on template compilation. Install the
      // teardown lifecycle and leave the dynamic (or absent) template to
      // Angular.
      return {
        text: installSxLifecycleIntoComponentSource(source, { ownedScopeFields }).source,
      };
    }
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
    preserveWhitespaces: match.preserveWhitespaces,
    resolveReactiveSource: standaloneDependencySources(program, checker, sourcePath),
    scopeValuePaths,
    writableSourcePaths: standaloneWritableSources(program, checker, sourcePath),
    scopeWritablePaths: scopeWritablePathsFor(program, sourcePath),
    ownedScopeFields,
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
    ownedScopeFields,
  }).source;
  try {
    return { text: installSxComponentTemplate(lifecycle, compiled.transformedTemplate) };
  } catch (error) {
    throw new Error(
      `[streamix] ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}


/** A fresh semantic graph is shared by all files in this watch batch. */
export async function regenerateAngularFiles(workspaceRoot: string, sourceRoot: string, changedPaths: readonly string[], introspection = false): Promise<void> {
  const sourceDirectory = resolve(workspaceRoot, resolveSourceRoot({ sourceRoot }));
  const overlays = new Map<string, string>();
  for (const changedPath of changedPaths) {
    const path = changedPath.replace(/\\/g, '/');
    if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.')) continue;
    if (!/\.[jt]sx?$/i.test(path) || /\.(?:d|spec|test)\.[jt]sx?$/i.test(path)) continue;
    try { overlays.set(join(sourceDirectory, path), await readFile(join(sourceDirectory, path), 'utf8')); }
    catch (error) { if (!['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  let program: Promise<ts.Program> | undefined;
  const semanticProgram = (create: () => Promise<ts.Program>): Promise<ts.Program> => program ??= create();
  for (const path of changedPaths) await regenerateAngularFileInternal(workspaceRoot, sourceRoot, path, introspection, semanticProgram, overlays);
}

export async function regenerateAngularFile(workspaceRoot: string, sourceRoot: string, changedPath: string, introspection = false): Promise<void> {
  await regenerateAngularFiles(workspaceRoot, sourceRoot, [changedPath], introspection);
}

/** Synchronize an authored source change into the delegated virtual project. */
async function regenerateAngularFileInternal(workspaceRoot: string, sourceRoot: string, changedPath: string, introspection: boolean, semanticProgram: (create: () => Promise<ts.Program>) => Promise<ts.Program>, overlays: Map<string, string>): Promise<void> {
  const validatedRoot = resolveSourceRoot({ sourceRoot });
  const sourceDirectory = resolve(workspaceRoot, validatedRoot);
  const outputDirectory = resolve(workspaceRoot, virtualRootOf(validatedRoot));
  const normalized = changedPath.replace(/\\/g, '/');
  if (!normalized || isAbsolute(normalized) || win32.isAbsolute(normalized) ||
      normalized.split('/').some(part => part === '..' || part === '.')) return;
  const origin = join(sourceDirectory, normalized);
  const destination = join(outputDirectory, normalized);
  let content: Buffer;
  try {
    const overlay = overlays.get(origin);
    content = overlay !== undefined ? Buffer.from(overlay) : await readFile(origin);
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
    await writeIfChanged(destination, content);
    return;
  }
  const authored = content.toString('utf8');

  const program = await semanticProgram(async () => {
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
    return createStreamixProgram({ fileNames: programRoots, options: parsedConfig.options }, overlays);
  });
  const checker = program.getTypeChecker();
  const compiled = await compileVirtualSource({
    workspaceRoot, sourceDirectory, sourcePath: origin, authored, program, checker, introspection,
    activateEntry: introspection && origin === await findEntry(sourceDirectory),
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
export function rewriteDerivedAtomReads(source: string, fileName = 'component.ts'): string {
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
  const explicitValueMembers = new Set(['value', 'safeValue']);
  const isExplicitValueRead = (node: ts.Expression): boolean => {
    const parent = node.parent;
    return (ts.isPropertyAccessExpression(parent) && parent.expression === node &&
      explicitValueMembers.has(parent.name.text)) ||
      (ts.isElementAccessExpression(parent) && parent.expression === node &&
        ts.isStringLiteralLike(parent.argumentExpression) && explicitValueMembers.has(parent.argumentExpression.text));
  };
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
      const callback = unwrapReactiveInitializer(node.arguments[0]);
      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
        if (ts.getModifiers(callback)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          const { line, character } = file.getLineAndCharacterOfPosition(callback.getStart(file));
          throw new Error(`[streamix] ${fileName}:${line + 1}:${character + 1}: derived() formulas must return synchronously. Use flow() for async work.`);
        }
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
            if (isExplicitValueRead(child)) {
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
            const isDeclaration = (ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
              ts.isBindingElement(parent) || ts.isPropertyAssignment(parent)) && parent.name === child;
            if (!isPropertyName && !isExplicitValueRead(child) && !isDeclaration) {
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
