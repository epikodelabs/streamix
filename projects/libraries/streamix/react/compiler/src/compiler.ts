import ts from 'typescript';
import { createTokenSourceMap } from './source-map';
import { hoistedVarDeclarations } from '@epikodelabs/streamix/compiler';

export interface ReactJsxTransformResult {
  /** Transformed TypeScript/TSX source. */
  readonly code: string;
  /** Number of reactive JSX bindings introduced by the transform. */
  readonly bindingCount: number;
  /** Diagnostics for syntax that cannot receive a safe implicit rewrite. */
  readonly diagnostics: readonly ReactJsxDiagnostic[];
  /** Original-source map with generated-binding and preserved-token anchors. */
  readonly sourceMap?: ReactJsxSourceMap;
}

/** Optional semantic context supplied by hosts that own a TypeScript Program. */
export interface ReactJsxTransformOptions {
  /** Resolves imported/re-exported Streamix factories by TypeScript symbol. */
  readonly program?: ts.Program;
}

export interface ReactJsxSourceMap {
  readonly version: 3;
  readonly file: string;
  readonly sources: readonly string[];
  readonly sourcesContent: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

export interface ReactJsxDiagnostic {
  readonly category: "error" | "warning";
  readonly message: string;
  readonly start: number;
  readonly length: number;
}

/** Formats compiler diagnostics with a source location and a one-line frame. */
export function formatReactJsxDiagnostics(
  source: string,
  fileName: string,
  diagnostics: readonly ReactJsxDiagnostic[],
): string {
  const lines = source.split(/\r\n|\r|\n/);
  return diagnostics.map(diagnostic => {
    let offset = 0;
    let lineIndex = 0;
    while (lineIndex < lines.length) {
      const newline = source.startsWith("\r\n", offset + lines[lineIndex].length) ? 2 :
        /[\r\n]/.test(source[offset + lines[lineIndex].length] ?? "") ? 1 : 0;
      if (offset + lines[lineIndex].length + newline > diagnostic.start) break;
      offset += lines[lineIndex].length + newline;
      lineIndex++;
    }
    const column = diagnostic.start - offset;
    const line = lines[lineIndex] ?? "";
    return `${fileName}:${lineIndex + 1}:${column + 1} - ${diagnostic.category}: ${diagnostic.message}\n` +
      `  ${line}\n  ${" ".repeat(Math.max(0, column))}^`;
  }).join("\n");
}

/**
 * Compiles Streamix value syntax inside React function components.
 *
 * A locally declared `atom()` may be used as a value in a direct JSX child or
 * property (`{count}`), and assignments to it (`count = next`) become
 * `count.next(next)`. A locally declared `scope()` gets the analogous JSX
 * shorthand: `{state.title}` becomes a subscription to `state.get("title")`.
 *
 * The generated hook calls are static and are inserted immediately after the
 * relevant atom/scope declarations, preserving React's Rules of Hooks.
 */
function isAtomWriteOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken || kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken || kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken || kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken || kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken || kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken || kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken || kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken;
}

function isNamePosition(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isShorthandPropertyAssignment(p) && p.name === node) return true;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) ||
       ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p)) && p.name === node) return true;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) ||
       ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === node) return true;
  return false;
}
function boundNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) { out.add(name.text); return; }
  for (const part of name.elements) if (!ts.isOmittedExpression(part)) boundNames(part.name, out);
}
function scopeBinds(node: ts.Node, name: string): boolean {
  const names = new Set<string>();
  if (ts.isFunctionLike(node)) for (const param of node.parameters) boundNames(param.name, names);
  if ((ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isClassLike(node)) && node.name)
    names.add(node.name.text);
  for (const declaration of hoistedVarDeclarations(node)) boundNames(declaration.name, names);
  if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isCaseBlock(node)) {
    const statements = ts.isCaseBlock(node) ? node.clauses.flatMap(clause => [...clause.statements]) : node.statements;
    for (const stmt of statements) {
      if (ts.isVariableStatement(stmt)) for (const declaration of stmt.declarationList.declarations) boundNames(declaration.name, names);
      if (ts.isFunctionDeclaration(stmt) && stmt.name) names.add(stmt.name.text);
      if (ts.isClassDeclaration(stmt) && stmt.name) names.add(stmt.name.text);
    }
  }
  if (ts.isArrowFunction(node) && ts.isExpression(node.body)) { /* parameters already checked */ }
  if (ts.isCatchClause(node) && node.variableDeclaration) boundNames(node.variableDeclaration.name, names);
  if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      node.initializer && ts.isVariableDeclarationList(node.initializer))
    for (const decl of node.initializer.declarations) boundNames(decl.name, names);
  return names.has(name);
}
function isShadowedName(name: string, site: ts.Node, component: ts.Node): boolean {
  let p: ts.Node | undefined = site.parent;
  while (p && p !== component) {
    // Declarations in the component's own body are handled by
    // `plainShadowed`. Treating this block as a nested scope would also hide
    // a component-local atom from every JSX read that follows its declaration.
    if (ts.isBlock(p) && p.parent === component) {
      p = p.parent;
      continue;
    }
    if (scopeBinds(p, name)) return true;
    p = p.parent;
  }
  return false;
}

/** True when a top-level statement can bypass later compiler-generated hooks. */
function statementMayReturn(statement: ts.Statement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}
function isShadowed(site: ts.Identifier, component: ts.Node): boolean {
  return isShadowedName(site.text, site, component);
}
/** Only an actual imported alias may use the syntactic fallback in a Program.
 * Local shadowing must not turn an unrelated factory into a Streamix atom. */
function isImportedSymbol(candidate: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(candidate);
  // An incomplete program may not yet resolve an authored explicit import.
  if (!symbol) return true;
  return !!(symbol.flags & ts.SymbolFlags.Alias) &&
    (symbol.declarations ?? []).some(declaration =>
      ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration));
}

/** Recognize wrappers imported from React, not similarly named foreign APIs. */
function reactWrappers(file: ts.SourceFile): (expression: ts.Expression) => boolean {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "react" || !statement.importClause) continue;
    if (statement.importClause.name) namespaces.add(statement.importClause.name.text);
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) {
      if (["memo", "forwardRef"].includes((specifier.propertyName ?? specifier.name).text))
        named.add(specifier.name.text);
    }
  }
  return expression => ts.isIdentifier(expression) ? named.has(expression.text) :
    ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
    namespaces.has(expression.expression.text) && ["memo", "forwardRef"].includes(expression.name.text);
}

/** React hooks whose callbacks run outside the compiler's JSX lowering. */
const NON_JSX_HOOKS = new Set(["useMemo", "useEffect", "useCallback"]);

/**
 * Recognize the React hooks whose inline callbacks are an explicit Streamix
 * boundary. Bare atom identifiers inside those callbacks would otherwise
 * observe the atom object instead of its value.
 */
function reactNonJsxHooks(file: ts.SourceFile): (expression: ts.Expression) => string | undefined {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "react" || !statement.importClause) continue;
    if (statement.importClause.name) namespaces.add(statement.importClause.name.text);
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) {
      const imported = (specifier.propertyName ?? specifier.name).text;
      if (NON_JSX_HOOKS.has(imported)) named.set(specifier.name.text, imported);
    }
  }
  return expression => {
    const base = ts.isIdentifier(expression) ? expression :
      ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression : undefined;
    if (base && isShadowedName(base.text, base, file)) return undefined;
    if (ts.isIdentifier(expression)) return named.get(expression.text);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
        namespaces.has(expression.expression.text) && NON_JSX_HOOKS.has(expression.name.text))
      return expression.name.text;
    return undefined;
  };
}

type FactoryImports = { aliases: Map<string, string>; namespaces: Set<string>; excluded: Set<string> };
function streamixFactoryImports(file: ts.SourceFile): FactoryImports {
  const aliases = new Map<string, string>();
  const namespaces = new Set<string>();
  const excluded = new Set<string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !stmt.importClause) continue;
    const isStreamix = /^@epikodelabs\/streamix(?:\/|$)/.test(stmt.moduleSpecifier.text);
    const bindings = stmt.importClause.namedBindings;
    if (stmt.importClause.name) excluded.add(stmt.importClause.name.text);
    if (bindings && ts.isNamespaceImport(bindings)) {
      (isStreamix ? namespaces : excluded).add(bindings.name.text);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (isStreamix) aliases.set(item.name.text, (item.propertyName ?? item.name).text);
        else excluded.add(item.name.text);
      }
    }
  }
  return { aliases, namespaces, excluded };
}
/**
 * Strips value-transparent wrappers (parentheses, `as`/angle-bracket
 * assertions, `satisfies`) so cast-wrapped factory initializers such as
 * `atom(0) as Writable<number>` adopt like the bare call they contain.
 */
function unwrapCast(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
function factoryKind(
  node: ts.Expression,
  imports: FactoryImports,
  checker?: ts.TypeChecker,
): string | undefined {
  node = unwrapCast(node);
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  // A host Program can be incomplete while a file is being edited.  Retain
  // explicit Streamix imports as a safe fallback instead of disabling every
  // transform just because semantic resolution momentarily failed.
  if (checker) {
    const semantic = semanticFactoryKind(callee, checker);
    if (semantic) return semantic;
    if (ts.isIdentifier(callee)) {
      const imported = imports.aliases.get(callee.text);
      if (imported && ["atom", "derived", "flow", "scope"].includes(imported) &&
          isImportedSymbol(callee, checker)) return imported;
      // Standalone/sandbox examples can use unbound global factory names.
      // A symbol proven to come from a different local/foreign declaration
      // must never be mistaken for Streamix.
      if (!imports.excluded.has(callee.text) && ["atom", "derived", "flow", "scope"].includes(callee.text) &&
          !checker.getSymbolAtLocation(callee)) return callee.text;
      return undefined;
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
        imports.namespaces.has(callee.expression.text) && ["atom", "derived", "flow", "scope"].includes(callee.name.text) &&
        isImportedSymbol(callee.expression, checker))
      return callee.name.text;
    return undefined;
  }
  if (ts.isIdentifier(callee)) {
    const name = imports.aliases.get(callee.text) ?? (imports.excluded.has(callee.text) ? undefined : callee.text);
    return name && ["atom", "derived", "flow", "scope"].includes(name) ? name : undefined;
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
      imports.namespaces.has(callee.expression.text) && ["atom", "derived", "flow", "scope"].includes(callee.name.text))
    return callee.name.text;
  return undefined;
}

function semanticFactoryKind(callee: ts.Expression, checker: ts.TypeChecker): string | undefined {
  const candidate = ts.isIdentifier(callee)
    ? callee
    : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
  if (!candidate) return undefined;
  let symbol = checker.getSymbolAtLocation(candidate);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const name = symbol.getName();
  if (!['atom', 'derived', 'flow', 'scope'].includes(name)) return undefined;
  const isStreamixDeclaration = (symbol.declarations ?? []).some(declaration => {
    const path = declaration.getSourceFile().fileName.replace(/\\/g, '/');
    return path.includes('/@epikodelabs/streamix/') || path.includes('/projects/libraries/streamix/');
  });
  return isStreamixDeclaration ? name : undefined;
}

export function transformReactJsx(
  source: string,
  fileName = "component.tsx",
  options: ReactJsxTransformOptions = {},
): ReactJsxTransformResult {
  const programSource = options.program?.getSourceFile(fileName);
  const sourceFile = programSource?.text === source ? programSource : ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?jsx?$/i.test(fileName) ? (/\.([cm]?jsx)$/i.test(fileName) ? ts.ScriptKind.JSX : ts.ScriptKind.JS) :
      /\.[cm]?ts$/i.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const checker = programSource?.text === source ? options.program?.getTypeChecker() : undefined;
  const isJavaScript = /\.[cm]?jsx?$/i.test(fileName);
  const imports = streamixFactoryImports(sourceFile);
  const isReactWrapper = reactWrappers(sourceFile);
  const reactNonJsxHook = reactNonJsxHooks(sourceFile);
  let bindingCount = 0;
  let needsRuntimeImport = false;
  const diagnostics: ReactJsxDiagnostic[] = [];
  const moduleAtoms = new Set([
    ...collectModuleBindings(sourceFile, "atom", imports, checker),
    ...collectModuleBindings(sourceFile, "derived", imports, checker),
    ...collectModuleBindings(sourceFile, "flow", imports, checker),
  ]);
  // Resolve shared reactive sources from other modules through the actual
  // TypeScript program. Plain imports stay untouched; structural proof requires
  // both a live value and an observable subscription (not an `any` guess).
  for (const name of collectImportedReactiveSources(sourceFile, checker)) moduleAtoms.add(name);
  const moduleScopes = collectModuleBindings(sourceFile, "scope", imports, checker);
  const moduleWritableAtoms = collectModuleWritableBindings(sourceFile, imports, checker);
  const moduleAtomMaps = collectModuleAtomMaps(sourceFile, moduleAtoms, moduleWritableAtoms);

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const factory = context.factory;
    const asAny = (expression: ts.Expression): ts.Expression => isJavaScript ? expression :
      factory.createAsExpression(expression, factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword));

    // One AST lowering path for module formulas, local formulas and shorthand
    // object properties. A regex cannot distinguish names from properties or
    // from lexically shadowed callback parameters.
    const lowerDerivedCallback = (
      call: ts.CallExpression,
      reactiveNames: ReadonlySet<string>,
      boundary: ts.Node,
      reactiveMaps: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(),
      hidden: (site: ts.Identifier) => boolean = () => false,
    ): ts.CallExpression => {
      if (!call.arguments.length || !(ts.isArrowFunction(call.arguments[0]) || ts.isFunctionExpression(call.arguments[0]))) return call;
      const callback = call.arguments[0];
      const callbackParameters = new Set<string>();
      for (const parameter of callback.parameters) boundNames(parameter.name, callbackParameters);
      const canRead = (id: ts.Identifier): boolean => reactiveNames.has(id.text) &&
        !callbackParameters.has(id.text) && !hidden(id) && !isShadowedName(id.text, id, boundary);
      // A proven atom-map member read resolves to its atom reference, with
      // canRead's guards applied to the base and to the resolved name: a
      // callback parameter or shadowing local must still win, and a member
      // of an arbitrary object is never guessed to be reactive.
      const resolveReactiveMapRead = (access: ts.Expression): string | undefined => {
        if (!ts.isPropertyAccessExpression(access) && !ts.isElementAccessExpression(access)) return undefined;
        if (!ts.isIdentifier(access.expression)) return undefined;
        const base = access.expression;
        const atomName = atomFromMapAccess(access, reactiveMaps);
        if (!atomName || !reactiveNames.has(atomName) || callbackParameters.has(base.text)) return undefined;
        if (hidden(base) || isShadowedName(base.text, base, boundary)) return undefined;
        if (isShadowedName(atomName, base, boundary)) return undefined;
        return atomName;
      };
      const lower: ts.Visitor = child => {
        // DerivedScope readers consume source references, regardless of their
        // parameter name; lowering their arguments would pass plain values.
        if (ts.isCallExpression(child)) {
          const callee = child.expression;
          const reader = ts.isPropertyAccessExpression(callee) &&
            ["read", "use"].includes(callee.name.text) ? callee.expression : callee;
          if (ts.isIdentifier(reader) && callbackParameters.has(reader.text) &&
              !isShadowedName(reader.text, reader, callback.body)) return child;
        }
        if (ts.isPropertyAccessExpression(child) && child.name.text === "value" &&
            (ts.isIdentifier(child.expression) && canRead(child.expression) ||
             resolveReactiveMapRead(child.expression) !== undefined)) return child;
        if (ts.isShorthandPropertyAssignment(child) && canRead(child.name)) {
          return factory.createPropertyAssignment(child.name, factory.createPropertyAccessExpression(child.name, "value"));
        }
        if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
          const atomName = resolveReactiveMapRead(child);
          if (atomName) return factory.createPropertyAccessExpression(factory.createIdentifier(atomName), "value");
        }
        if (ts.isIdentifier(child) && !isNamePosition(child) && canRead(child))
          return factory.createPropertyAccessExpression(child, "value");
        return ts.visitEachChild(child, lower, context);
      };
      const body = ts.visitNode(callback.body, lower) as ts.ConciseBody;
      const replacement = ts.isArrowFunction(callback)
        ? factory.updateArrowFunction(callback, callback.modifiers, callback.typeParameters, callback.parameters, callback.type, callback.equalsGreaterThanToken, body)
        : factory.updateFunctionExpression(callback, callback.modifiers, callback.asteriskToken, callback.name, callback.typeParameters, callback.parameters, callback.type, body as ts.Block);
      return factory.updateCallExpression(call, call.expression, call.typeArguments, [replacement, ...call.arguments.slice(1)]);
    };
    const lowerModuleFormulas: ts.Visitor = node => {
      if (ts.isCallExpression(node) && factoryKind(node, imports, checker) === "derived")
        return lowerDerivedCallback(node, moduleAtoms, sourceFile, moduleAtomMaps);
      return ts.visitEachChild(node, lowerModuleFormulas, context);
    };

    const transformFunction = <T extends ts.FunctionLikeDeclarationBase>(node: T, traceName?: string): T => {
      if (!node.body) return node;
      const functionBody = ts.isBlock(node.body) ? node.body :
        factory.createBlock([factory.createReturnStatement(node.body)], true);
      const isComponent = !!traceName && /^[A-Z]/.test(traceName);

      const atoms = new Set<string>(moduleAtoms);
      const scopes = new Set<string>(moduleScopes);
      // A map records only locally-created object literals whose entries are
      // known atom references. It lets `model.count` and `{ count } = model`
      // retain the source identity without guessing about arbitrary objects.
      const atomMaps = new Map(moduleAtomMaps);
      const writableBindings = new Set<string>(moduleWritableAtoms);
      const localReactiveDeclarations = new Set<ts.VariableDeclaration>();
      const localAtomMapDeclarations = new Set<ts.VariableDeclaration>();
      // Statements whose declarations supply names the generated hook bindings
      // reference directly (local atoms/scopes, aliases, map bases, and
      // destructured map members). Bindings must be inserted after the last
      // one so every referenced name is initialized; nothing before that point
      // may return conditionally, or the hooks would run conditionally.
      const bindingDependencies = new Set<number>();
      let insertionIndex = 0;

      // A destructured prop explicitly typed as `typeof someAtom` is a shared
      // atom reference at this component boundary. This keeps the receiving
      // component compiler-first too: `<Editor source={title} />` can render
      // `{source}` without a manual `.value` read.
      collectTypedAtomProps(node, moduleAtoms, atoms);
      collectTypedScopeProps(node, moduleScopes, scopes);

      let hasEarlierReturn = false;
      functionBody.statements.forEach((statement, index) => {
        const statementReturns = statementMayReturn(statement);
        let declaresReactive = false;
        if (!ts.isVariableStatement(statement)) {
          if (statementReturns) hasEarlierReturn = true;
          return;
        }
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer ? unwrapCast(declaration.initializer) : undefined;
          if (!ts.isIdentifier(declaration.name) || !initializer || !ts.isCallExpression(initializer)) {
            continue;
          }
          {
            const kind = factoryKind(initializer, imports, checker);
            if (kind === "atom" || kind === "derived" || kind === "flow") {
              if (hasEarlierReturn) {
                diagnostics.push(diagnostic(
                  declaration,
                  "error",
                  "A component-local reactive declaration cannot appear after a possible return. Move it before every return or use an explicit hook so React hook order is static.",
                ));
                continue;
              }
              atoms.add(declaration.name.text);
              localReactiveDeclarations.add(declaration);
              if (isComponent) reportLocalFactoryImpurity(initializer, diagnostics);
              if ((statement.declarationList.flags & ts.NodeFlags.Let) !== 0) writableBindings.add(declaration.name.text);
              declaresReactive = true;
            }
            if (kind === "scope") {
              if (hasEarlierReturn) {
                diagnostics.push(diagnostic(
                  declaration,
                  "error",
                  "A component-local reactive declaration cannot appear after a possible return. Move it before every return or use an explicit hook so React hook order is static.",
                ));
                continue;
              }
              scopes.add(declaration.name.text);
              localReactiveDeclarations.add(declaration);
              if (isComponent) reportLocalFactoryImpurity(initializer, diagnostics);
              declaresReactive = true;
            }
          }
        }
        if (declaresReactive) insertionIndex = index + 1;
        if (statementReturns) hasEarlierReturn = true;
      });

      // Static aliases retain atom identity. Object maps are supported only
      // when every property is a known atom reference; arbitrary objects stay
      // ordinary JavaScript and are never guessed to be reactive.
      let changed = true;
      while (changed) {
        changed = false;
        functionBody.statements.forEach((statement, index) => {
          if (!ts.isVariableStatement(statement)) return;
          for (const declaration of statement.declarationList.declarations) {
            if (!declaration.initializer) continue;
            if (
              ts.isIdentifier(declaration.name) &&
              ts.isIdentifier(declaration.initializer) &&
              atoms.has(declaration.initializer.text) &&
              !atoms.has(declaration.name.text)
            ) {
              atoms.add(declaration.name.text);
              if ((statement.declarationList.flags & ts.NodeFlags.Let) !== 0) writableBindings.add(declaration.name.text);
              changed = true;
              bindingDependencies.add(index);
            }
            if (ts.isIdentifier(declaration.name) && ts.isObjectLiteralExpression(declaration.initializer)) {
              const entries = new Map<string, string>();
              for (const property of declaration.initializer.properties) {
                const propertyName = staticPropertyName(property.name);
                const value = ts.isPropertyAssignment(property)
                  ? property.initializer
                  : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
                if (!propertyName || !value || !ts.isIdentifier(value) || !atoms.has(value.text)) {
                  entries.clear();
                  break;
                }
                entries.set(propertyName, value.text);
              }
              if (entries.size > 0) {
                atomMaps.set(declaration.name.text, entries);
                localAtomMapDeclarations.add(declaration);
                bindingDependencies.add(index);
              }
            }
            if (
              ts.isObjectBindingPattern(declaration.name) &&
              ts.isIdentifier(declaration.initializer) &&
              atomMaps.has(declaration.initializer.text)
            ) {
              const map = atomMaps.get(declaration.initializer.text)!;
              let contributed = false;
              for (const element of declaration.name.elements) {
                const propertyName = element.propertyName
                  ? staticPropertyName(element.propertyName)
                  : ts.isIdentifier(element.name) ? element.name.text : undefined;
                if (!propertyName || !ts.isIdentifier(element.name)) continue;
                const atomName = map.get(propertyName);
                if (!atomName) continue;
                atoms.add(element.name.text);
                if ((statement.declarationList.flags & ts.NodeFlags.Let) !== 0 && writableBindings.has(atomName)) {
                  writableBindings.add(element.name.text);
                }
                contributed = true;
              }
              if (contributed) bindingDependencies.add(index);
            }
          }
        });
      }

      // Generated hook bindings must execute after every name they reference
      // is initialized. Nothing before that insertion point may return
      // conditionally, or React would observe a different hook order between
      // renders, so report it instead of emitting conditional hooks.
      for (const dependencyIndex of bindingDependencies) {
        insertionIndex = Math.max(insertionIndex, dependencyIndex + 1);
      }
      for (let guardIndex = 0; guardIndex < insertionIndex; guardIndex++) {
        if (statementMayReturn(functionBody.statements[guardIndex])) {
          diagnostics.push(diagnostic(
            functionBody.statements[guardIndex],
            "error",
            "A possible return precedes the reactive declarations, so the generated subscription hooks would run conditionally. Move the reactive declarations before every return so React hook order stays static.",
          ));
          break;
        }
      }

      // Plain locals and untyped parameters hide module-level reactive names.
      // Do not mistake a shadowing primitive for the imported/module atom.
      const plainShadowed = new Set<string>();
      for (const param of node.parameters) {
        const names = new Set<string>(); boundNames(param.name, names);
        for (const name of names) if (!atoms.has(name) && !scopes.has(name)) plainShadowed.add(name);
      }
      const componentDeclarations = new Set(hoistedVarDeclarations(node));
      for (const statement of functionBody.statements) {
        if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name)
          plainShadowed.add(statement.name.text);
        if (ts.isVariableStatement(statement))
          for (const declaration of statement.declarationList.declarations) componentDeclarations.add(declaration);
      }
      for (const declaration of componentDeclarations) {
        const names = new Set<string>(); boundNames(declaration.name, names);
        for (const name of names) {
          if (!localAtomMapDeclarations.has(declaration) && !localReactiveDeclarations.has(declaration) &&
              !(ts.isIdentifier(declaration.name) && declaration.initializer && ts.isIdentifier(declaration.initializer) && atoms.has(declaration.initializer.text)) &&
              !(ts.isObjectBindingPattern(declaration.name) && declaration.initializer &&
                ts.isIdentifier(declaration.initializer) && atomMaps.has(declaration.initializer.text) && atoms.has(name))) {
            plainShadowed.add(name);
          }
        }
      }
      const isHidden = (site: ts.Identifier): boolean => plainShadowed.has(site.text) || isShadowed(site, node);
      const isHiddenTarget = (site: ts.Expression): boolean => {
        let base: ts.Expression = site;
        while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) base = base.expression;
        return ts.isIdentifier(base) && isHidden(base);
      };
      // Resolve aliases at their declaration site. Name-only sets cannot
      // distinguish an outer source from a block/catch/parameter shadow.
      if (isComponent) {
        type Shape = true | Map<string, Shape>;
        const visiting = new Set<ts.VariableDeclaration>();
        const bindingShape = (binding: ts.BindingName, name: string, shape: Shape | undefined): Shape | undefined => {
          if (ts.isIdentifier(binding)) return binding.text === name ? shape : undefined;
          for (let index = 0; index < binding.elements.length; index++) {
            const element = binding.elements[index];
            if (ts.isOmittedExpression(element)) continue;
            const key = ts.isArrayBindingPattern(binding) ? String(index) : element.propertyName
              ? staticPropertyName(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : undefined;
            const selected = element.dotDotDotToken ? shape : shape === true ? true : key ? shape?.get(key) : undefined;
            const result = bindingShape(element.name, name, selected);
            if (result) return result;
          }
          return undefined;
        };
        const declarationShape = (declaration: ts.VariableDeclaration, name: string): Shape | undefined => {
          if (!declaration.initializer || visiting.has(declaration)) return undefined;
          visiting.add(declaration);
          const shape = bindingShape(declaration.name, name, expressionShape(declaration.initializer));
          visiting.delete(declaration);
          return shape;
        };
        const expressionShape = (expression: ts.Expression): Shape | undefined => {
          expression = unwrapCast(expression);
          if (factoryKind(expression, imports, checker)) return true;
          if (ts.isIdentifier(expression)) {
            for (let scope = expression.parent; scope; scope = scope.parent) {
              if (!scopeBinds(scope, expression.text)) continue;
              const declarations = [...hoistedVarDeclarations(scope)];
              if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isCaseBlock(scope)) {
                const statements = ts.isCaseBlock(scope) ? scope.clauses.flatMap(clause => [...clause.statements]) : scope.statements;
                for (const statement of statements) if (ts.isVariableStatement(statement)) declarations.push(...statement.declarationList.declarations);
              }
              if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
                  scope.initializer && ts.isVariableDeclarationList(scope.initializer)) declarations.push(...scope.initializer.declarations);
              for (const declaration of declarations) {
                const names = new Set<string>(); boundNames(declaration.name, names);
                if (names.has(expression.text)) return declarationShape(declaration, expression.text);
              }
              return undefined; // Parameter, catch, function or class shadow.
            }
            return moduleAtoms.has(expression.text) ? true : undefined;
          }
          if (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression)) {
            const entries = new Map<string, Shape>();
            const properties = ts.isObjectLiteralExpression(expression) ? expression.properties : expression.elements;
            properties.forEach((property, index) => {
              const key = ts.isArrayLiteralExpression(expression) ? String(index) :
                (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) ? staticPropertyName(property.name) : undefined;
              const value = ts.isPropertyAssignment(property) ? property.initializer :
                ts.isShorthandPropertyAssignment(property) ? property.name : ts.isExpression(property) ? property : undefined;
              const shape = value && expressionShape(value);
              if (key && shape) entries.set(key, shape);
            });
            return entries.size ? entries : undefined;
          }
          if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
            const shape = expressionShape(expression.expression);
            const key = ts.isPropertyAccessExpression(expression) ? expression.name.text :
              expression.argumentExpression && (ts.isStringLiteral(expression.argumentExpression) || ts.isNumericLiteral(expression.argumentExpression)) ? expression.argumentExpression.text : undefined;
            return shape === true ? undefined : key ? shape?.get(key) : undefined;
          }
          // Explicit local hooks retain source identity too; inspect their
          // factory, without adding ownership/subscription hooks here.
          if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) &&
              ['useStreamixLocal', 'useAtom'].includes(expression.expression.text)) {
            const imported = sourceFile.statements.some(statement => ts.isImportDeclaration(statement) &&
              ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@epikodelabs/streamix/react' &&
              statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
              statement.importClause.namedBindings.elements.some(element => element.name.text === (expression.expression as ts.Identifier).text));
            const callback = expression.arguments[0];
            if (imported && !scopeBinds(node, expression.expression.text) && !scopeBinds(functionBody, expression.expression.text) &&
                !isShadowedName(expression.expression.text, expression.expression, node) &&
                callback && ts.isArrowFunction(callback) && ts.isExpression(callback.body)) return expressionShape(callback.body);
          }
          return undefined;
        };
        const inspectNestedDeclarations = (child: ts.Node): void => {
          const names = new Set<string>();
          if (ts.isVariableDeclaration(child)) boundNames(child.name, names);
          if (ts.isVariableDeclaration(child) && child.initializer && child.parent.parent.parent !== functionBody &&
              [...names].some(name => declarationShape(child, name))) {
            diagnostics.push(diagnostic(child, "error",
              "A component-local reactive declaration or alias inside a nested block cannot be compiled safely. Move it to component scope or use an explicit React hook."));
            return;
          }
          ts.forEachChild(child, inspectNestedDeclarations);
        };
        inspectNestedDeclarations(functionBody);
      }
      /** Whether an assignment expression's result is consumed by its parent. */
      const assignmentValueUsed = (expression: ts.Expression): boolean => {
        let current: ts.Node = expression;
        let parent = current.parent;
        while (parent && (
          ts.isParenthesizedExpression(parent) ||
          ts.isAsExpression(parent) ||
          ts.isTypeAssertionExpression(parent) ||
          ts.isNonNullExpression(parent) ||
          ts.isSatisfiesExpression(parent)
        )) {
          current = parent;
          parent = parent.parent;
        }
        if (!parent) return true;
        if (ts.isExpressionStatement(parent)) return false;
        if (ts.isForStatement(parent) && (parent.initializer === current || parent.incrementor === current)) return false;
        if (ts.isVoidExpression(parent)) return false;
        // A concise arrow body returns its value, including when used as an
        // event handler. Only genuinely discarded expression positions skip
        // the value-preserving write.
        if (
          ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.CommaToken &&
          parent.right !== current
        ) return false;
        if (
          ts.isBinaryExpression(parent) &&
          isAssignmentOperator(parent.operatorToken.kind) &&
          parent.left === current
        ) return false;
        return true;
      };

      /** Atom write that evaluates to the assigned value, like JavaScript. */
      const writeAtomResult = (atomName: string, initializer: ts.Expression): ts.Expression => {
        // Evaluate the RHS as a call argument, in its authored scope, so
        // await/yield stay outside the generated synchronous wrapper.
        const assigned = factory.createUniqueName("__streamixAssigned");
        const atom = factory.createIdentifier(atomName);
        return factory.createCallExpression(
          factory.createParenthesizedExpression(factory.createArrowFunction(
            undefined,
            undefined,
            [factory.createParameterDeclaration(undefined, undefined, assigned, undefined, isJavaScript
              ? undefined : factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))],
            undefined,
            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            factory.createBlock([
              factory.createExpressionStatement(writeAtom(factory, atom, assigned)),
              factory.createReturnStatement(assigned),
            ], true),
          )),
          undefined,
          [initializer],
        );
      };

      /**
       * An element-access write on a known atom map whose key cannot be
       * statically resolved to a known entry cannot be lowered: `.value` is
       * getter-only, and authored JavaScript would silently replace the atom
       * reference. Report it like the other unwritable atom targets.
       */
      const reportUnresolvedMapWrite = (target: ts.Expression): void => {
        const text = target.getText(sourceFile);
        diagnostics.push(diagnostic(target, "error",
          `Cannot assign to atom map entry "${text}" because its key does not statically resolve to a known atom. Resolve the atom first (const target = ${text}) and call target.next(value), or use a statically known key.`));
      };

      let lowerAssignmentExpression: (
        node: ts.BinaryExpression,
        valueUsed: boolean,
      ) => ts.Expression | undefined;

      /**
       * Recursively lowers atom writes nested inside an assignment value. A
       * nested assignment is a value position: its result is what the outer
       * assignment stores, so it must use the value-preserving form.
       */
      const lowerNestedAssignmentValues = (expression: ts.Expression): ts.Expression => {
        if (ts.isBinaryExpression(expression) && isAssignmentOperator(expression.operatorToken.kind)) {
          return lowerAssignmentExpression(expression, true) ?? expression;
        }
        // Nested functions/classes own their bindings. The main visitor handles
        // them separately; descending here could lower a shadowing local.
        if (ts.isFunctionLike(expression) || ts.isClassExpression(expression)) return expression;
        let changed = false;
        const lowered = ts.visitEachChild(
          expression,
          child => {
            if (!ts.isExpression(child)) return child;
            const next = lowerNestedAssignmentValues(child);
            if (next !== child) changed = true;
            return next;
          },
          context,
        );
        return changed ? lowered as ts.Expression : expression;
      };

      lowerAssignmentExpression = (node, valueUsed) => {
        const atomName = !isHiddenTarget(node.left)
          ? atomReferenceName(node.left, atoms, atomMaps)
          : undefined;
        const loweredRight = lowerNestedAssignmentValues(node.right);
        if (!atomName) {
          // An ordinary target still participates in chains; only its right
          // side can contain atom writes. The surrounding pass rewrites reads.
          if (loweredRight === node.right) return undefined;
          return factory.updateBinaryExpression(node, node.left, node.operatorToken, loweredRight);
        }
        const right = rewriteAtomReads(loweredRight, atoms, atomMaps, context, node.right, isHidden);
        if (!writableBindings.has(atomName)) {
          diagnostics.push(diagnostic(node, "error", `Cannot assign to read-only atom binding "${atomName}". Declare it with let or call ${atomName}.next(value).`));
          return undefined;
        }
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          return valueUsed
            ? writeAtomResult(atomName, right)
            : writeAtom(factory, factory.createIdentifier(atomName), right);
        }
        const operator = compoundOperator(factory, node.operatorToken.kind);
        if (operator !== undefined) {
          const nextValue = factory.createBinaryExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier(atomName), "value"),
            operator,
            right,
          );
          return valueUsed
            ? writeAtomResult(atomName, nextValue)
            : writeAtom(factory, factory.createIdentifier(atomName), nextValue);
        }
        if (isLogicalAssignment(node.operatorToken.kind)) {
          return writeLogicalAtom(factory, atomName, node.operatorToken.kind, right);
        }
        // The operator table and the write-operator predicate disagree;
        // leaving the statement unrewritten would write the atom object itself.
        diagnostics.push(diagnostic(node, "error", `Compound write "${node.operatorToken.getText(sourceFile)}" cannot be lowered for atom "${atomName}". Write ${atomName}.next(...) explicitly.`));
        return undefined;
      };
      const componentParameters = new Set<string>();
      for (const parameter of node.parameters) boundNames(parameter.name, componentParameters);
      // Hook bindings are emitted at component scope. A selection that closes
      // over a callback-local value (for example `items.map(item => map[item])`)
      // cannot be hoisted there without producing a temporal-dead-zone or an
      // undefined identifier. Only component parameters and known reactive
      // bases are safe to reference from the generated hook statement.
      const canHoistDynamicSource = (source: ts.Expression): boolean => {
        let safe = true;
        const inspect = (part: ts.Node): void => {
          if (!safe) return;
          if (ts.isIdentifier(part)) {
            if (isNamePosition(part)) return;
            if (!componentParameters.has(part.text) && !atoms.has(part.text) && !atomMaps.has(part.text)) safe = false;
            return;
          }
          ts.forEachChild(part, inspect);
        };
        inspect(source);
        return safe;
      };
      if (atoms.size === 0 && scopes.size === 0) return node;

      const bindings: ts.Statement[] = [];
      const atomBindings = new Map<string, ts.Identifier>();
      const scopeBindings = new Map<string, ts.Identifier>();
      // Source references subscribed by this component. The render trace
      // carries them so the runtime can attribute a commit to this component's
      // own writes instead of consuming a shared counter.
      const traceSources = new Map<string, ts.Expression>();
      // Every generated-binding reference site, recorded so the eager-read
      // guard can tell which closures would read a binding before it is
      // declared.
      const bindingReferenceSites: ts.Node[] = [];
      const bindingForAtom = (atomName: string, _source: ts.Node): ts.Identifier => {
        bindingReferenceSites.push(_source);
        traceSources.set(atomName, factory.createIdentifier(atomName));
        const existing = atomBindings.get(atomName);
        if (existing) return existing;
        const name = factory.createIdentifier(`__streamixBinding${bindingCount++}`);
        atomBindings.set(atomName, name);
        needsRuntimeImport = true;
        const statement = factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
              name,
              undefined,
              undefined,
              asAny(
              factory.createCallExpression(factory.createIdentifier("useStreamixSource"), undefined, [
                  factory.createIdentifier(atomName),
                factory.createStringLiteral(atomName),
                ]),
              ),
            ),
          ], ts.NodeFlags.Const),
        );
        bindings.push(statement);
        return name;
      };
      const bindingForSource = (atomSource: ts.Expression, key: string, _source: ts.Node = atomSource): ts.Identifier => {
        bindingReferenceSites.push(_source);
        traceSources.set(key, atomSource);
        const existing = atomBindings.get(key);
        if (existing) return existing;
        const name = factory.createIdentifier(`__streamixBinding${bindingCount++}`);
        atomBindings.set(key, name);
        needsRuntimeImport = true;
        const statement = factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
              name,
              undefined,
              undefined,
              asAny(
                factory.createCallExpression(factory.createIdentifier("useStreamixSource"), undefined, [
                  // Dynamic selections resolve to whatever atom lives at the
                  // key at runtime, so the source is deliberately type-agnostic:
                  // a heterogeneous union (string and number atoms) must still
                  // satisfy the subscription helper's parameter.
                  asAny(atomSource),
                  factory.createStringLiteral(key),
                ]),
              ),
            ),
          ], ts.NodeFlags.Const),
        );
        bindings.push(statement);
        return name;
      };
      const bindingForScope = (scopeName: string, property: string, _source: ts.Node): ts.Identifier => {
        bindingReferenceSites.push(_source);
        const bindingKey = `${scopeName}.${property}`;
        const existing = scopeBindings.get(bindingKey);
        if (existing) return existing;
        const name = factory.createIdentifier(`__streamixBinding${bindingCount++}`);
        scopeBindings.set(bindingKey, name);
        needsRuntimeImport = true;
        const sourceExpression = factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier(scopeName), "get"),
          undefined,
          [factory.createStringLiteral(property)],
        );
        traceSources.set(bindingKey, sourceExpression);
        const statement = factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
              name,
              undefined,
              undefined,
              asAny(
                factory.createCallExpression(factory.createIdentifier("useStreamixSource"), undefined, [
                  sourceExpression,
                  factory.createStringLiteral(`${scopeName}.${property}`),
                ]),
              ),
            ),
          ], ts.NodeFlags.Const),
        );
        bindings.push(statement);
        return name;
      };
      const rewriteJsxValue = (expression: ts.Expression): ts.Expression => {
        const jsxValueVisitor: ts.Visitor = (value) => {
          // An explicit `.value` read is still a JSX read of the atom. Lower
          // the whole expression to the subscription binding rather than
          // descending into the base identifier, which would leave the
          // binding (already the current value) with a second `.value`.
          if (
            ts.isPropertyAccessExpression(value) &&
            value.name.text === "value" &&
            !isHiddenTarget(value.expression)
          ) {
            const baseName = atomReferenceName(value.expression, atoms, atomMaps);
            if (baseName) return bindingForAtom(baseName, value);
            if (
              ts.isElementAccessExpression(value.expression) &&
              ts.isIdentifier(value.expression.expression) &&
              atomMaps.has(value.expression.expression.text)
            ) {
              if (!canHoistDynamicSource(value.expression)) {
                diagnostics.push(diagnostic(value, "error", "A dynamic atom selection captures a callback-local value and cannot be compiled into a component hook. Move the selection to component scope or use an explicit subscription."));
                return value;
              }
              return bindingForSource(value.expression, value.expression.getText(sourceFile), value);
            }
          }
          if (ts.isShorthandPropertyAssignment(value) && atoms.has(value.name.text) && !isHidden(value.name)) {
            return factory.createPropertyAssignment(value.name, bindingForAtom(value.name.text, value));
          }
          if (ts.isIdentifier(value) && atoms.has(value.text) && !isNamePosition(value) && !isHidden(value)) {
            return bindingForAtom(value.text, value);
          }
          if (
            ts.isPropertyAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            atomMaps.has(value.expression.text) &&
            !isHidden(value.expression) &&
            atomFromMapAccess(value, atomMaps)
          ) {
            return bindingForAtom(atomFromMapAccess(value, atomMaps)!, value);
          }
          if (
            ts.isElementAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            atomMaps.has(value.expression.text) &&
            !isHidden(value.expression)
          ) {
            if (!canHoistDynamicSource(value)) {
              diagnostics.push(diagnostic(value, "error", "A dynamic atom selection captures a callback-local value and cannot be compiled into a component hook. Move the selection to component scope or use an explicit subscription."));
              return value;
            }
            return bindingForSource(value, value.getText(sourceFile));
          }
          if (
            ts.isPropertyAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            scopes.has(value.expression.text) &&
            !isHidden(value.expression)
          ) {
            return bindingForScope(value.expression.text, value.name.text, value);
          }
          if (
            ts.isElementAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            scopes.has(value.expression.text) &&
            !isHidden(value.expression) &&
            value.argumentExpression &&
            (ts.isStringLiteral(value.argumentExpression) || ts.isNumericLiteral(value.argumentExpression))
          ) {
            return bindingForScope(value.expression.text, value.argumentExpression.text, value);
          }
          if (
            ts.isElementAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            scopes.has(value.expression.text) &&
            !isHidden(value.expression)
          ) {
            diagnostics.push(diagnostic(value, "error", "Dynamic scope-field reads are ambiguous. Use scope.get(key) with an explicit runtime boundary."));
            return value;
          }
          if (
            ts.isConditionalExpression(value) &&
            ts.isIdentifier(value.whenTrue) &&
            ts.isIdentifier(value.whenFalse) &&
            atoms.has(value.whenTrue.text) && !isHidden(value.whenTrue) &&
            atoms.has(value.whenFalse.text) && !isHidden(value.whenFalse)
          ) {
            if (!canHoistDynamicSource(value)) {
              diagnostics.push(diagnostic(value, "error", "A conditional atom selection captures a callback-local value and cannot be compiled into a component hook. Move the selection to component scope or use an explicit subscription."));
              return value;
            }
            return bindingForSource(value, value.getText(sourceFile));
          }
          return ts.visitEachChild(value, jsxValueVisitor, context);
        };
        return ts.visitNode(expression, jsxValueVisitor) as ts.Expression;
      };

      /**
       * Non-JSX React callbacks are an explicit Streamix boundary: writes are
       * lowered, but standalone reads would still observe the atom object.
       * Report every bare atom read that survives the lowering pass. JSX
       * subtrees, derived formulas, explicit atom APIs, and atom writes are
       * handled elsewhere and are skipped deliberately.
       */
      const inspectedHookCallbacks = new Set<ts.Node>();
      /**
       * Resolve an inline callback or a directly referenced local/module
       * function so the boundary check covers `useEffect(handler)` as well as
       * `useEffect(() => ...)`.
       */
      const hookCallbackFor = (argument: ts.Expression | undefined): ts.FunctionLikeDeclarationBase | undefined => {
        if (!argument) return undefined;
        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return argument;
        if (!ts.isIdentifier(argument) || isShadowedName(argument.text, argument, node)) return undefined;
        const statements = [...functionBody.statements, ...sourceFile.statements];
        for (const statement of statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === argument.text && statement.body)
            return statement;
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== argument.text || !declaration.initializer) continue;
            if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
              return declaration.initializer;
          }
        }
        return undefined;
      };
      const reportHookCallbackReads = (
        callback: ts.FunctionLikeDeclarationBase,
        hook: string,
      ): void => {
        if (inspectedHookCallbacks.has(callback)) return;
        inspectedHookCallbacks.add(callback);
        const explicitAtomApis = new Set(["read", "write", "atomRef", "useAtomValue", "useWritable"]);
        const calledName = (callee: ts.Expression): string | undefined =>
          ts.isIdentifier(callee) ? callee.text :
            ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        const unwrap = (expression: ts.Expression): ts.Expression => {
          let current = expression;
          while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
                 ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
                 ts.isSatisfiesExpression(current)) current = current.expression;
          return current;
        };
        const report = (site: ts.Node, atomName: string): void => {
          diagnostics.push(diagnostic(site, "error",
            `Atom "${atomName}" is used as a value inside a ${hook} callback. Non-JSX callbacks are an explicit boundary: read ${atomName}.value, use read(${atomName}), capture useAtomValue(${atomName}) at component scope, or pass the source with atomRef(${atomName}).`));
        };
        const inspect = (child: ts.Node): void => {
          // JSX expressions receive subscription bindings; type positions are
          // not runtime reads.
          if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) ||
              ts.isJsxFragment(child) || ts.isJsxExpression(child) || ts.isTypeNode(child)) return;
          if (ts.isCallExpression(child)) {
            // Nested hook callbacks are reported by their own call site.
            if (reactNonJsxHook(child.expression)) return;
            if (factoryKind(child, imports, checker) === "derived") return;
            const api = calledName(child.expression);
            if (api && explicitAtomApis.has(api)) {
              // The first argument is the atom source itself; later arguments
              // are still value positions.
              child.arguments.forEach((argument, index) => { if (index > 0) inspect(argument); });
              return;
            }
          }
          // A write target and its right side are lowered as a unit.
          if (ts.isBinaryExpression(child) && isAssignmentOperator(child.operatorToken.kind) &&
              !isHiddenTarget(child.left) && atomReferenceName(child.left, atoms, atomMaps)) return;
          // An unresolvable atom-map write is reported by the write pass; its
          // right side is not lowered, so bare reads there still violate the
          // boundary.
          if (ts.isBinaryExpression(child) && isAssignmentOperator(child.operatorToken.kind) &&
              !isHiddenTarget(child.left) && unresolvedAtomMapAccessBase(child.left, atomMaps)) {
            inspect(child.right);
            return;
          }
          // Destructured atom writes lower the targets, not the right side.
          if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              (ts.isObjectLiteralExpression(child.left) || ts.isArrayLiteralExpression(child.left)) &&
              destructuredAtomTargets(child.left, atoms, atomMaps).length > 0) {
            inspect(child.right);
            return;
          }
          // ++/-- on an atom is a write, not a value read.
          if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) &&
              (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken) &&
              !isHiddenTarget(child.operand) && atomReferenceName(child.operand, atoms, atomMaps)) return;
          // Same for unresolvable atom-map updates, reported by the write pass.
          if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) &&
              (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken) &&
              !isHiddenTarget(child.operand) && unresolvedAtomMapAccessBase(child.operand, atomMaps)) return;
          // Any explicit atom member access (.value, .next, .subscribe, ...)
          // deliberately uses the source object.
          if ((ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) &&
              !isHiddenTarget(child.expression) &&
              atomReferenceName(unwrap(child.expression), atoms, atomMaps)) return;
          if (ts.isShorthandPropertyAssignment(child) && atoms.has(child.name.text) && !isHidden(child.name)) {
            report(child.name, child.name.text);
            return;
          }
          if (ts.isIdentifier(child) && atoms.has(child.text) && !isNamePosition(child) && !isHidden(child)) {
            report(child, child.text);
            return;
          }
          if ((ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) &&
              ts.isIdentifier(child.expression) && !isHidden(child.expression)) {
            const atomName = atomFromMapAccess(child, atomMaps);
            if (atomName) { report(child, atomName); return; }
            if (ts.isElementAccessExpression(child) && atomMaps.has(child.expression.text)) {
              report(child, child.expression.text);
              return;
            }
          }
          ts.forEachChild(child, inspect);
        };
        ts.forEachChild(callback, inspect);
      };

      /**
       * Generated bindings initialize at the insertion point, so any
       * statement before it that reads a binding crashes with a temporal
       * dead zone error: either eagerly rendered JSX, or a closure invoked
       * before the declarations whose body — or an eagerly invoked inner
       * closure — renders reactive JSX. The conditional-return guard covers
       * returns; this covers eager reads. The shape is diagnosed, not
       * reordered, mirroring the conditional-return handling.
       */
      const reportEagerBindingReads = (): void => {
        if (insertionIndex === 0 || bindingReferenceSites.length === 0) return;
        const unwrap = (expression: ts.Expression): ts.Expression => {
          let current = expression;
          while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
                 ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
                 ts.isSatisfiesExpression(current)) current = current.expression;
          return current;
        };
        const statementIndexOf = (target: ts.Node): number => {
          let current: ts.Node | undefined = target;
          while (current && current.parent && current.parent !== functionBody) current = current.parent;
          return current ? functionBody.statements.indexOf(current as ts.Statement) : -1;
        };
        /** The nearest enclosing closure: invoking it evaluates the site. */
        const enclosingClosure = (site: ts.Node): ts.FunctionLikeDeclarationBase | undefined => {
          let current: ts.Node | undefined = site;
          while (current && current !== functionBody && current !== node) {
            if (ts.isFunctionLike(current)) return current as ts.FunctionLikeDeclarationBase;
            current = current.parent;
          }
          return undefined;
        };
        const closures: ts.FunctionLikeDeclarationBase[] = [];
        const collectClosures = (child: ts.Node): void => {
          if (child !== node && ts.isFunctionLike(child)) closures.push(child as ts.FunctionLikeDeclarationBase);
          ts.forEachChild(child, collectClosures);
        };
        collectClosures(functionBody);
        const declaredName = (closure: ts.FunctionLikeDeclarationBase): string | undefined => {
          if (ts.isFunctionDeclaration(closure)) return closure.name?.text;
          if (ts.isVariableDeclaration(closure.parent) && ts.isIdentifier(closure.parent.name)) return closure.parent.name.text;
          return undefined;
        };
        const closureStatementIndex = new Map<ts.FunctionLikeDeclarationBase, number>(
          closures.map(closure => [closure, statementIndexOf(closure)]));
        /** Resolve an invoked name to component-body closures. */
        const resolveName = (identifier: ts.Identifier, statement: number): ts.FunctionLikeDeclarationBase[] => {
          if (isShadowedName(identifier.text, identifier, node)) return [];
          return closures.filter(closure => {
            if (declaredName(closure) !== identifier.text) return false;
            // Hoisted function declarations resolve from anywhere; bound
            // closures must already be declared at the call's statement.
            if (ts.isFunctionDeclaration(closure)) return true;
            const index = closureStatementIndex.get(closure) ?? -1;
            return index >= 0 && index <= statement;
          });
        };
        /** Calls and synchronous array methods that run their closure arguments immediately. */
        const syncInvokers = new Set(["map", "filter", "forEach", "find", "findIndex", "findLast", "findLastIndex",
          "some", "every", "reduce", "reduceRight", "flatMap", "sort", "toSorted"]);
        const invokedClosures = (call: ts.CallExpression, statement: number): ts.FunctionLikeDeclarationBase[] => {
          const resolved = new Set<ts.FunctionLikeDeclarationBase>();
          const consider = (expression: ts.Expression): void => {
            const value = unwrap(expression);
            if (ts.isFunctionLike(value)) resolved.add(value as ts.FunctionLikeDeclarationBase);
            else if (ts.isIdentifier(value)) for (const target of resolveName(value, statement)) resolved.add(target);
          };
          consider(call.expression);
          if (ts.isIdentifier(call.expression) && reactNonJsxHook(call.expression) === "useMemo" && call.arguments.length) {
            // useMemo runs its factory during the call, unlike the deferred
            // effect-style hooks.
            consider(call.arguments[0]);
          }
          if (ts.isPropertyAccessExpression(call.expression) && syncInvokers.has(call.expression.name.text)) {
            for (const argument of call.arguments) consider(argument);
          }
          return [...resolved];
        };
        // Direct references: the nearest enclosing closure reads the binding
        // when invoked; a site above any closure renders eagerly with its
        // statement.
        const siteSets = new Map<ts.FunctionLikeDeclarationBase, Set<ts.Node>>();
        for (const site of bindingReferenceSites) {
          const closure = enclosingClosure(site);
          if (closure) {
            let sites = siteSets.get(closure);
            if (!sites) siteSets.set(closure, sites = new Set());
            sites.add(site);
          } else {
            const index = statementIndexOf(site);
            if (index >= 0 && index < insertionIndex) {
              const statement = functionBody.statements[index];
              diagnostics.push(diagnostic(statement, "error",
                "This statement renders reactive JSX before the generated subscription bindings are declared, reading a binding before initialization. Move the statement below the reactive declarations, or move the reactive JSX read into a closure invoked after them."));
            }
          }
        }
        // A closure that eagerly invokes — or passes to a synchronous
        // invoker — another closure inherits its references, so chained
        // helpers are covered too.
        let changed = true;
        while (changed) {
          changed = false;
          for (const closure of closures) {
            if (!closure.body) continue;
            const inherit = (expression: ts.Expression): void => {
              const value = unwrap(expression);
              let source: ts.FunctionLikeDeclarationBase | undefined;
              if (ts.isFunctionLike(value)) source = value as ts.FunctionLikeDeclarationBase;
              else if (ts.isIdentifier(value)) {
                const targets = resolveName(value, closureStatementIndex.get(closure) ?? -1);
                if (targets.length === 1) source = targets[0];
              }
              if (!source || source === closure) return;
              const sites = siteSets.get(source);
              if (!sites?.size) return;
              let target = siteSets.get(closure);
              if (!target) siteSets.set(closure, target = new Set());
              for (const site of sites) if (!target.has(site)) { target.add(site); changed = true; }
            };
            const walkEager = (child: ts.Node): void => {
              if (ts.isFunctionLike(child) && child !== closure) return;
              if (ts.isCallExpression(child)) {
                inherit(child.expression);
                if (ts.isPropertyAccessExpression(child.expression) && syncInvokers.has(child.expression.name.text)) {
                  for (const argument of child.arguments) inherit(argument);
                }
              }
              ts.forEachChild(child, walkEager);
            };
            walkEager(closure.body);
          }
        }
        // A pre-insertion statement that eagerly invokes a closure holding
        // binding references crashes on every render.
        for (let index = 0; index < insertionIndex; index++) {
          const statement = functionBody.statements[index];
          const walkEager = (child: ts.Node): void => {
            if (ts.isFunctionLike(child)) return;
            if (ts.isCallExpression(child)) {
              for (const target of invokedClosures(child, index)) {
                const sites = siteSets.get(target);
                if (!sites?.size) continue;
                const name = declaredName(target);
                diagnostics.push(diagnostic(child, "error",
                  `This eager call runs before the generated subscription bindings are declared, so ${name ? `"${name}"` : "an inline closure"} would read a binding before initialization. Move the call below the reactive declarations, or move the reactive JSX out of the eagerly invoked closure.`));
                break;
              }
            }
            ts.forEachChild(child, walkEager);
          };
          walkEager(statement);
        }
      };

      const visit: ts.Visitor = (child) => {
        if (ts.isCallExpression(child)) {
          const hook = reactNonJsxHook(child.expression);
          if (hook) {
            const callback = hookCallbackFor(child.arguments[0]);
            if (callback) reportHookCallbackReads(callback, hook);
          }
        }
        if (ts.isCallExpression(child) && factoryKind(child, imports, checker) === "derived") {
          return lowerDerivedCallback(child, atoms, node, atomMaps, isHidden);
        }
        if (isComponent && ts.isVariableDeclaration(child) && localReactiveDeclarations.has(child) && child.initializer) {
          needsRuntimeImport = true;
          const initializer = ts.visitNode(child.initializer, visit) as ts.Expression;
          return factory.updateVariableDeclaration(
            child,
            child.name,
            child.exclamationToken,
            child.type,
            factory.createCallExpression(factory.createIdentifier("useStreamixLocal"), undefined, [
              factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                initializer,
              ),
            ]),
          );
        }
        if (
          ts.isBinaryExpression(child) &&
          child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          (ts.isObjectLiteralExpression(child.left) || ts.isArrayLiteralExpression(child.left))
        ) {
          const targets = destructuredAtomTargets(child.left, atoms, atomMaps).filter(target => !plainShadowed.has(target.atomName) && !isShadowedName(target.atomName, child, node));
          if (targets.length > 0) {
            // Unknown (non-atom) targets carry no atom name; only resolved
            // atom targets can be read-only. Treating the rest as read-only
            // made the mixed-destructuring warning unreachable.
            const readOnly = targets.find(target => target.known && !writableBindings.has(target.atomName));
            if (readOnly) {
              diagnostics.push(diagnostic(child, "error", `Cannot assign to read-only atom binding \"${readOnly.atomName}\" through destructuring.`));
              return child;
            }
            if (targets.every(target => target.known)) {
              return writeDestructuredAtoms(factory, child.right, targets, atoms, atomMaps, context);
            }
            diagnostics.push(diagnostic(child, "warning", "Mixed destructured atom assignment is not rewritten. Write each atom explicitly to preserve JavaScript assignment semantics."));
            return child;
          }
        }
        if (ts.isBinaryExpression(child) && isAssignmentOperator(child.operatorToken.kind) &&
            !isHiddenTarget(child.left) && unresolvedAtomMapAccessBase(child.left, atomMaps)) {
          reportUnresolvedMapWrite(child.left);
        }
        if (ts.isBinaryExpression(child) && isAssignmentOperator(child.operatorToken.kind) &&
            !isHiddenTarget(child.left) && atomReferenceName(child.left, atoms, atomMaps)) {
          const lowered = lowerAssignmentExpression(child, assignmentValueUsed(child));
          return lowered ?? child;
        }
        if (ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) {
          const operand = child.operand;
          const atomName = isHiddenTarget(operand) ? undefined : atomReferenceName(operand, atoms, atomMaps);
          const isIncrement = child.operator === ts.SyntaxKind.PlusPlusToken;
          const isDecrement = child.operator === ts.SyntaxKind.MinusMinusToken;
          if (atomName && (isIncrement || isDecrement)) {
            if (!writableBindings.has(atomName)) {
              diagnostics.push(diagnostic(child, "error", `Cannot update read-only atom binding \"${atomName}\". Declare it with let or call ${atomName}.next(value).`));
              return child;
            }
            return updateAtom(factory, atomName, isIncrement, ts.isPostfixUnaryExpression(child));
          }
          if ((isIncrement || isDecrement) && !isHiddenTarget(operand) &&
              unresolvedAtomMapAccessBase(operand, atomMaps)) {
            reportUnresolvedMapWrite(operand);
          }
        }

        if (ts.isJsxSpreadAttribute(child)) {
          // A spread places an object's properties on the element, so atom
          // reads inside it are value reads, not transport props. Plain
          // objects and arbitrary expressions stay untouched.
          const lowered = rewriteJsxValue(child.expression);
          return lowered === child.expression ? child : factory.updateJsxSpreadAttribute(child, lowered);
        }

        if (ts.isJsxExpression(child) && child.expression) {
          // React reserves `ref` for a ref object or callback on intrinsic
          // elements. Lowering an atom read there would hand React the atom's
          // value, which is invalid at runtime; reject it with guidance.
          if (ts.isJsxAttribute(child.parent) && child.parent.name.getText(sourceFile) === "ref" &&
              isNativeJsxAttribute(child.parent)) {
            const readsReactiveValue = !isHiddenTarget(child.expression) && (
              atomReferenceName(child.expression, atoms, atomMaps) !== undefined ||
              isScopeMemberRead(child.expression, scopes, isHidden) ||
              (ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "value" &&
                !isHiddenTarget(child.expression.expression) &&
                (atomReferenceName(child.expression.expression, atoms, atomMaps) !== undefined ||
                 isScopeMemberRead(child.expression.expression, scopes, isHidden))));
            if (readsReactiveValue) {
              diagnostics.push(diagnostic(child, "error",
                "React's ref slot expects a ref object or callback, not an atom value. Pass a ref object, or use a different prop name to transport the atom."));
              return child;
            }
          }
          if (ts.isArrowFunction(child.expression) || ts.isFunctionExpression(child.expression)) {
            const lowered = ts.visitNode(child.expression, visit) as ts.Expression;
            return factory.updateJsxExpression(child, rewriteAtomReads(lowered, atoms, atomMaps, context, child.expression, isHidden));
          }
          if (isSharedAtomComponentProp(child, atoms, atomMaps)) {
            return child;
          }
          return factory.updateJsxExpression(child, rewriteJsxValue(child.expression));
        }

        return ts.visitEachChild(child, visit, context);
      };

      const body = ts.visitEachChild(functionBody, visit, context) as ts.Block;
      if (isComponent) reportEagerBindingReads();
      if (!isComponent && bindings.length > 0) {
        diagnostics.push(diagnostic(node, "error", "Reactive JSX in a non-component function cannot use generated React hooks. Rename it as a React component or use an explicit component boundary."));
        return node;
      }
      if (bindings.length === 0 && (!isComponent || localReactiveDeclarations.size === 0)) {
        // Write-only helpers still need their lowered bodies. Returning the
        // original node here discarded `count = value` and `count++` whenever
        // JSX did not introduce a subscription binding.
        return body === functionBody ? node : updateFunctionLike(factory, node, body);
      }

      // Trace only after React commits. Recording while the function body is
      // evaluated would itself be an observable render-phase side effect and
      // would lie for interrupted concurrent renders. Arrow and memo/forwardRef
      // components trace under their declared name.
      if (traceName && /^[A-Z]/.test(traceName)) {
        bindings.push(factory.createExpressionStatement(factory.createCallExpression(
          factory.createIdentifier("useStreamixAfterCommit"),
          undefined,
          [
            factory.createArrowFunction(
              undefined,
              undefined,
              [],
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              factory.createBlock([
                factory.createExpressionStatement(factory.createCallExpression(
                  factory.createIdentifier("__streamixTrace"),
                  undefined,
                  [factory.createStringLiteral("render"), factory.createStringLiteral(traceName)],
                )),
              ], true),
            ),
            // Attribution list: the runtime traces this render only when one
            // of these sources was written since this component's last commit.
            factory.createArrayLiteralExpression([...traceSources.values()]),
          ],
        )));
      }

      const statements = [
        ...body.statements.slice(0, insertionIndex),
        ...bindings,
        ...body.statements.slice(insertionIndex),
      ];
      const updatedBody = factory.updateBlock(body, statements);
      return updateFunctionLike(factory, node, updatedBody);
    };

    const transformInitializer = (expr: ts.Expression, traceName?: string): ts.Expression => {
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return transformFunction(expr, traceName);
      // A component-shaped callback remains a React render function when it is
      // passed through an application HOC.  React's built-ins are merely the
      // common case; restricting this rewrite to their spelling made ordinary
      // HOCs leave atom objects in JSX.
      if (ts.isCallExpression(expr) && expr.arguments.length > 0 &&
          (isReactWrapper(expr.expression) || (!!traceName && /^[A-Z]/.test(traceName)))) {
        const first = transformInitializer(expr.arguments[0], traceName);
        return first === expr.arguments[0] ? expr : factory.updateCallExpression(expr, expr.expression, expr.typeArguments, [first, ...expr.arguments.slice(1)]);
      }
      return expr;
    };

    const transformClassComponent = (node: ts.ClassDeclaration): readonly ts.Statement[] | undefined => {
      const isDefault = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      // An anonymous class has no module binding to preserve, but a default
      // export is still a stable component boundary. Give both generated
      // declarations private names and keep the default export on the wrapper.
      if ((!node.name && !isDefault) || (node.name && !/^[A-Z]/.test(node.name.text))) return undefined;
      const publicName = node.name?.text ?? 'StreamixDefaultExport';
      let hasJsx = false;
      const findJsx = (child: ts.Node): void => {
        if (child !== node && ts.isClassLike(child)) return;
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) hasJsx = true;
        if (!hasJsx) ts.forEachChild(child, findJsx);
      };
      findJsx(node);
      if (!hasJsx) return undefined;

      const writeSource = (target: ts.Expression): string | undefined => {
        target = unwrapCast(target);
        let base = target;
        while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) base = base.expression;
        if (ts.isIdentifier(base) && isShadowedName(base.text, base, node)) return undefined;
        return atomReferenceName(target, moduleAtoms, moduleAtomMaps) ??
          (ts.isPropertyAccessExpression(target) && target.name.text === 'value'
            ? atomReferenceName(target.expression, moduleAtoms, moduleAtomMaps) : undefined);
      };
      const reportWrite = (target: ts.Expression, site: ts.Node): void => {
        const names = ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target)
          ? destructuredAtomTargets(target, moduleAtoms, moduleAtomMaps)
              .filter(target => !isShadowedName(target.atomName, site, node)).map(target => target.atomName)
          : [writeSource(target)].filter((name): name is string => !!name);
        for (const name of new Set(names)) diagnostics.push(diagnostic(site, 'error',
          `Implicit atom writes inside class components are not supported. Use ${name}.next(value) to update the source.`));
      };
      const inspectWrites = (child: ts.Node): void => {
        if (child !== node && ts.isClassLike(child)) return;
        if (ts.isBinaryExpression(child) && isAssignmentOperator(child.operatorToken.kind)) reportWrite(child.left, child);
        if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) &&
            (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken))
          reportWrite(child.operand, child);
        if ((ts.isForOfStatement(child) || ts.isForInStatement(child)) && !ts.isVariableDeclarationList(child.initializer))
          reportWrite(child.initializer, child);
        ts.forEachChild(child, inspectWrites);
      };
      inspectWrites(node);
      const atomSources = new Set<string>();
      const scopeSources = new Map<string, Set<string>>();
      // The outer function owns both the subscriptions and their snapshots.
      // Keeping the snapshots in a private prop gives the class a normal
      // render input rather than making it re-read mutable sources itself.
      const snapshot = (key: string): ts.Expression => factory.createElementAccessExpression(
        factory.createPropertyAccessExpression(
          asAny(factory.createPropertyAccessExpression(factory.createThis(), "props")),
          "__streamixBindings",
        ),
        factory.createStringLiteral(key),
      );
      const recordScope = (scope: string, property: string): void => {
        let properties = scopeSources.get(scope);
        if (!properties) scopeSources.set(scope, properties = new Set());
        properties.add(property);
      };
      const rewriteExpression = (expression: ts.Expression): ts.Expression => {
        const visit: ts.Visitor = value => {
          // Snapshots are render inputs, never assignment targets. Keep the
          // authored lvalue even when a diagnostic rejects an implicit write.
          if (ts.isBinaryExpression(value) && isAssignmentOperator(value.operatorToken.kind)) {
            return factory.updateBinaryExpression(value, value.left, value.operatorToken,
              ts.visitNode(value.right, visit) as ts.Expression);
          }
          if ((ts.isPrefixUnaryExpression(value) || ts.isPostfixUnaryExpression(value)) &&
              (value.operator === ts.SyntaxKind.PlusPlusToken || value.operator === ts.SyntaxKind.MinusMinusToken)) return value;
          if (ts.isForOfStatement(value)) return factory.updateForOfStatement(value, value.awaitModifier, value.initializer,
            ts.visitNode(value.expression, visit) as ts.Expression, ts.visitNode(value.statement, visit) as ts.Statement);
          if (ts.isForInStatement(value)) return factory.updateForInStatement(value, value.initializer,
            ts.visitNode(value.expression, visit) as ts.Expression, ts.visitNode(value.statement, visit) as ts.Statement);
          // Explicit source methods (especially .next) must keep their source
          // receiver. Their call arguments still descend through the visitor.
          if ((ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) &&
              !(ts.isPropertyAccessExpression(value) && value.name.text === 'value') &&
              writeSource(value.expression)) return value;
          if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) &&
              moduleScopes.has(value.expression.text) && ['get', 'set', 'dispose', 'subscribe'].includes(value.name.text) &&
              !isShadowedName(value.expression.text, value, node)) return value;
          if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) &&
              moduleScopes.has(value.expression.text) && !isShadowedName(value.expression.text, value, node)) {
            recordScope(value.expression.text, value.name.text);
            return snapshot(`${value.expression.text}.${value.name.text}`);
          }
          if (ts.isPropertyAccessExpression(value) && value.name.text === "value" &&
              ts.isIdentifier(value.expression) && moduleAtoms.has(value.expression.text) &&
              !isShadowedName(value.expression.text, value, node)) {
            atomSources.add(value.expression.text);
            return snapshot(value.expression.text);
          }
          if (ts.isIdentifier(value) && moduleAtoms.has(value.text) && !isNamePosition(value) &&
              !isShadowedName(value.text, value, node)) {
            atomSources.add(value.text);
            return snapshot(value.text);
          }
          return ts.visitEachChild(value, visit, context);
        };
        return ts.visitNode(expression, visit) as ts.Expression;
      };
      const visit: ts.Visitor = child => {
        if (ts.isJsxExpression(child) && child.expression &&
            !isSharedAtomComponentProp(child, moduleAtoms, moduleAtomMaps))
          return factory.updateJsxExpression(child, rewriteExpression(child.expression));
        return ts.visitEachChild(child, visit, context);
      };
      const rewritten = ts.visitEachChild(node, visit, context) as ts.ClassDeclaration;
      if (atomSources.size === 0 && scopeSources.size === 0) return undefined;

      const internalName = factory.createIdentifier(`__Streamix${publicName}`);
      const classModifiers = node.modifiers?.filter(modifier =>
        modifier.kind !== ts.SyntaxKind.ExportKeyword && modifier.kind !== ts.SyntaxKind.DefaultKeyword);
      const internal = factory.updateClassDeclaration(rewritten, classModifiers, internalName,
        rewritten.typeParameters, rewritten.heritageClauses, rewritten.members);
      const wrapperModifiers = node.modifiers?.filter(modifier =>
        modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword);
      const hookStatements: ts.Statement[] = [];
      const snapshots: ts.ObjectLiteralElementLike[] = [];
      for (const atomName of atomSources) {
        const binding = factory.createIdentifier(`__streamixClassBinding${bindingCount++}`);
        needsRuntimeImport = true;
        hookStatements.push(factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(binding, undefined, undefined, factory.createCallExpression(
            factory.createIdentifier("useStreamixSource"), undefined,
            [factory.createIdentifier(atomName), factory.createStringLiteral(atomName)],
          )),
        ], ts.NodeFlags.Const)));
        snapshots.push(factory.createPropertyAssignment(atomName, binding));
      }
      for (const [scopeName, properties] of scopeSources) for (const property of properties) {
        const key = `${scopeName}.${property}`;
        const binding = factory.createIdentifier(`__streamixClassBinding${bindingCount++}`);
        needsRuntimeImport = true;
        hookStatements.push(factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(binding, undefined, undefined, factory.createCallExpression(
            factory.createIdentifier("useStreamixSource"), undefined,
          [factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier(scopeName), "get"), undefined,
            [factory.createStringLiteral(property)]), factory.createStringLiteral(key)],
          )),
        ], ts.NodeFlags.Const)));
        snapshots.push(factory.createPropertyAssignment(factory.createStringLiteral(key), binding));
      }
      const props = factory.createIdentifier("props");
      const parameter = factory.createParameterDeclaration(undefined, undefined, props, undefined,
        isJavaScript ? undefined : factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword));
      const wrappedClass = factory.createJsxSelfClosingElement(internalName, undefined,
        factory.createJsxAttributes([
          factory.createJsxSpreadAttribute(props),
          factory.createJsxAttribute(factory.createIdentifier("__streamixBindings"),
            factory.createJsxExpression(undefined, factory.createObjectLiteralExpression(snapshots, false))),
        ]));
      const wrapper = factory.createFunctionDeclaration(wrapperModifiers, undefined, factory.createIdentifier(publicName),
        undefined, [parameter], undefined, factory.createBlock([
          ...hookStatements,
          factory.createReturnStatement(wrappedClass),
        ], true));
      return [internal, wrapper];
    };
    return file => {
      const statements: ts.Statement[] = [];
      for (const statement of file.statements) {
        if (ts.isClassDeclaration(statement)) {
          const adopted = transformClassComponent(statement);
          if (adopted) { statements.push(...adopted); continue; }
        }
        if (ts.isFunctionDeclaration(statement)) {
          const isDefault = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
          statements.push(transformFunction(statement, isDefault ? "DefaultExport" : statement.name?.text));
          continue;
        }
        if (ts.isVariableStatement(statement)) {
          const declarations = statement.declarationList.declarations.map(declaration => {
            if (!declaration.initializer) return declaration;
            const init = ts.visitNode(declaration.initializer, lowerModuleFormulas) as ts.Expression;
            if (!ts.isIdentifier(declaration.name)) {
              return init === declaration.initializer ? declaration : factory.updateVariableDeclaration(declaration, declaration.name, declaration.exclamationToken, declaration.type, init);
            }
            const updated = transformInitializer(init, declaration.name.text);
            return updated === declaration.initializer ? declaration : factory.updateVariableDeclaration(declaration, declaration.name, declaration.exclamationToken, declaration.type, updated);
          });
          statements.push(factory.updateVariableStatement(statement, statement.modifiers,
            factory.updateVariableDeclarationList(statement.declarationList, declarations)));
          continue;
        }
        if (ts.isExportAssignment(statement)) {
          const expr = transformInitializer(statement.expression, statement.isExportEquals ? undefined : "DefaultExport");
          statements.push(expr === statement.expression ? statement : factory.updateExportAssignment(statement, statement.modifiers, expr));
          continue;
        }
        statements.push(statement);
      }
      return factory.updateSourceFile(file, statements);
    };
  };

  // Nested components need an independent hook lifetime. The top-level class
  // adapter above provides that lifetime through its generated wrapper.
  const inspectSkipped = (node: ts.Node): void => {
    // Nested components have their own hook lifetime. Transforming only the
    // outer component would leave their implicit reads unbound, while blindly
    // lifting hooks into the parent would violate React's Rules of Hooks.
    // A component is nested when a block or function body sits between it and
    // the module. Module-scope arrow components — `const Widget = () => ...`
    // — are ordinary adoption targets even when they read module atoms, so
    // they must not be flagged.
    const nested = (): boolean => {
      for (let ancestor = node.parent; ancestor && ancestor !== sourceFile; ancestor = ancestor.parent) {
        if (ts.isBlock(ancestor)) return true;
      }
      return false;
    };
    if (nested() && (
      ts.isFunctionDeclaration(node) && !!node.name && /^[A-Z]/.test(node.name.text) ||
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text) &&
        !!node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )) {
      const name = ts.isFunctionDeclaration(node) ? node.name!.text : (node as ts.VariableDeclaration).name.getText(sourceFile);
      const reactiveAncestors = new Set([...moduleAtoms, ...moduleScopes]);
      for (let ancestor = node.parent; ancestor && ancestor !== sourceFile; ancestor = ancestor.parent) {
        if (!ts.isBlock(ancestor)) continue;
        for (const statement of ancestor.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.initializer &&
                ["atom", "derived", "flow", "scope"].includes(factoryKind(declaration.initializer, imports, checker) ?? ""))
              reactiveAncestors.add(declaration.name.text);
          }
        }
      }
      if ([...reactiveAncestors].some(atomName => new RegExp(`\\b${atomName}\\b`).test(node.getText(sourceFile)))) {
        diagnostics.push(diagnostic(node, "error", `Nested component ${name} requires an independent compilation boundary. Move it to module scope or use explicit React hooks.`));
      }
    }
    ts.forEachChild(node, inspectSkipped);
  };
  inspectSkipped(sourceFile);
  const transformed = ts.transform(sourceFile, [transformer]).transformed[0] as ts.SourceFile;
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const printed = printer.printFile(transformed);
  const directive = printed.match(/^(\s*["']use client["'];?\s*\n)/);
  // A `"use client"` directive must remain the first statement, and
  // TypeScript only honors `@ts-check` / `@ts-nocheck` within leading
  // comments. The generated import goes after such a head instead of at
  // the very top, so an authored pragma stays effective.
  const head = directive?.[0] ??
    /^\s*(?:\/\/[^\n]*\n)*\s*\/\/[^\n]*@ts-(?:no)?check\b[^\n]*\n/.exec(printed)?.[0] ??
    "";
  const code = needsRuntimeImport && /\b(?:useStreamixSource|useStreamixLocal|useStreamixAfterCommit)\s*\(/.test(printed)
    ? `${head}${runtimePreludeFor(printed)}\n${printed.slice(head.length)}`
    : printed;
  return {
    code,
    bindingCount,
    diagnostics,
    sourceMap: createTokenSourceMap(sourceFile.text, code, sourceFile.fileName),
  };
}

/**
 * Emits original-source anchors for generated bindings and preserved tokens.
 * Generated runtime imports intentionally remain unmapped, while compiler
 * bindings map directly to their JSX source expression. Bundlers can compose
 * this with their normal TSX/JS maps without exposing the virtual source tree.
 */
/**
 * A bare atom supplied to a user component is a transport of shared state,
 * not a render read. Preserve the reference so the receiving component can
 * subscribe, write, or pass it on. Native DOM attributes still receive a
 * snapshot through the regular JSX rewrite.
 */
/** True for intrinsic JSX tags (`div`, `my-element`), whose `ref` slot is
 * reserved by React. Capitalized and member-expression tags are components. */
function isNativeJsxAttribute(attribute: ts.JsxAttribute): boolean {
  const attributes = attribute.parent;
  const opening = attributes?.parent;
  return (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
    ts.isIdentifier(opening.tagName) && /^[a-z]/.test(opening.tagName.text);
}

/** A direct scope-member read on a live scope container. */
function isScopeMemberRead(
  expression: ts.Expression,
  scopes: ReadonlySet<string>,
  isHidden: (identifier: ts.Identifier) => boolean,
): boolean {
  return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
    scopes.has(expression.expression.text) && !isHidden(expression.expression);
}

function isSharedAtomComponentProp(
  expression: ts.JsxExpression,
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): boolean {
  if (!expression.expression || !isAtomReferenceExpression(expression.expression, atoms, atomMaps)) {
    return false;
  }
  if (!ts.isJsxAttribute(expression.parent)) return false;
  // `atomRef()` is an explicit transport marker and is therefore valid for
  // custom elements and third-party components too. A bare atom remains
  // implicit only for conventional capitalized React component boundaries.
  if (ts.isCallExpression(expression.expression)) return true;
  const attributes = expression.parent.parent;
  const opening = attributes?.parent;
  const tagName = ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)
    ? opening.tagName
    : undefined;
  return tagName !== undefined && (
    ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text) ||
    ts.isPropertyAccessExpression(tagName) && ts.isIdentifier(tagName.expression) && /^[A-Z]/.test(tagName.expression.text)
  );
}

function isAtomReferenceExpression(
  expression: ts.Expression,
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): boolean {
  if (ts.isIdentifier(expression)) return atoms.has(expression.text);
  if ((ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) && atomFromMapAccess(expression, atomMaps)) return true;
  return ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) && expression.expression.text === "atomRef" &&
    expression.arguments.length === 1 &&
    ts.isIdentifier(expression.arguments[0]) && atoms.has(expression.arguments[0].text);
}

function runtimePreludeFor(code: string): string {
  const names = ["useStreamixAfterCommit", "useStreamixLocal", "__streamixTrace", "useStreamixSource"]
    .filter(name => code.includes(`${name}(`));
  // An authored import already binds the identifier; injecting our own line
  // for the same name would be a duplicate declaration (TS2300).
  const authored = new Set<string>();
  const file = ts.createSourceFile("prelude.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      if (names.includes(element.name.text)) authored.add(element.name.text);
    }
  }
  const missing = names.filter(name => !authored.has(name));
  return missing.length > 0
    ? `import { ${missing.join(", ")} } from "@epikodelabs/streamix/react";`
    : "";
}

function collectImportedReactiveSources(file: ts.SourceFile, checker?: ts.TypeChecker): Set<string> {
  const names = new Set<string>();
  if (!checker) return names;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        /^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    const candidates: ts.Identifier[] = [];
    if (clause.name) candidates.push(clause.name);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
      candidates.push(...clause.namedBindings.elements.map(element => element.name));
    for (const identifier of candidates) {
      const type = checker.getTypeAtLocation(identifier);
      if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) continue;
      const value = type.getProperty("value");
      const subscribe = type.getProperty("subscribe");
      if (!value || !subscribe) continue;
      const subscriptionType = checker.getTypeOfSymbolAtLocation(subscribe, identifier);
      if (subscriptionType.getCallSignatures().length > 0) names.add(identifier.text);
    }
  }
  return names;
}

function collectModuleBindings(
  sourceFile: ts.SourceFile,
  factoryName: string,
  imports: FactoryImports,
  checker?: ts.TypeChecker,
): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer ? unwrapCast(declaration.initializer) : undefined;
      if (!ts.isIdentifier(declaration.name) || !initializer || !ts.isCallExpression(initializer)) continue;
      if (factoryKind(initializer, imports, checker) === factoryName) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function collectModuleWritableBindings(
  sourceFile: ts.SourceFile,
  imports: FactoryImports,
  checker?: ts.TypeChecker,
): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Let) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer ? unwrapCast(declaration.initializer) : undefined;
      if (!ts.isIdentifier(declaration.name) || !initializer || !ts.isCallExpression(initializer)) continue;
      if (["atom", "derived", "flow"].includes(factoryKind(initializer, imports, checker) ?? "")) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

/** Performs the same conservative alias analysis for module-owned atoms. */
function collectModuleAtomMaps(
  sourceFile: ts.SourceFile,
  atoms: Set<string>,
  writableBindings: Set<string>,
): Map<string, Map<string, string>> {
  const maps = new Map<string, Map<string, string>>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const writable = (statement.declarationList.flags & ts.NodeFlags.Let) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue;
        if (
          ts.isIdentifier(declaration.name) &&
          ts.isIdentifier(declaration.initializer) &&
          atoms.has(declaration.initializer.text) &&
          !atoms.has(declaration.name.text)
        ) {
          atoms.add(declaration.name.text);
          if (writable) writableBindings.add(declaration.name.text);
          changed = true;
        }
        if (ts.isIdentifier(declaration.name) && ts.isObjectLiteralExpression(declaration.initializer)) {
          const entries = new Map<string, string>();
          for (const property of declaration.initializer.properties) {
            const propertyName = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
              ? staticPropertyName(property.name)
              : undefined;
            const value = ts.isPropertyAssignment(property)
              ? property.initializer
              : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
            if (!propertyName || !value || !ts.isIdentifier(value) || !atoms.has(value.text)) {
              entries.clear();
              break;
            }
            entries.set(propertyName, value.text);
          }
          if (entries.size > 0 && !maps.has(declaration.name.text)) {
            maps.set(declaration.name.text, entries);
            changed = true;
          }
        }
        if (
          ts.isObjectBindingPattern(declaration.name) &&
          ts.isIdentifier(declaration.initializer) &&
          maps.has(declaration.initializer.text)
        ) {
          const map = maps.get(declaration.initializer.text)!;
          for (const element of declaration.name.elements) {
            const propertyName = element.propertyName
              ? staticPropertyName(element.propertyName)
              : ts.isIdentifier(element.name) ? element.name.text : undefined;
            if (!propertyName || !ts.isIdentifier(element.name)) continue;
            const atomName = map.get(propertyName);
            if (!atomName || atoms.has(element.name.text)) continue;
            atoms.add(element.name.text);
            if (writable && writableBindings.has(atomName)) writableBindings.add(element.name.text);
            changed = true;
          }
        }
      }
    }
  }
  return maps;
}

function collectTypedAtomProps(
  node: ts.FunctionLikeDeclarationBase,
  knownAtoms: ReadonlySet<string>,
  atoms: Set<string>,
): void {
  for (const parameter of node.parameters) {
    if (!ts.isObjectBindingPattern(parameter.name) || !parameter.type || !ts.isTypeLiteralNode(parameter.type)) {
      continue;
    }
    const typedProperties = new Map<string, string>();
    for (const member of parameter.type.members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name || !ts.isTypeQueryNode(member.type)) continue;
      const propertyName = staticPropertyName(member.name);
      const typeName = ts.isIdentifier(member.type.exprName) ? member.type.exprName.text : undefined;
      if (propertyName && typeName && knownAtoms.has(typeName)) typedProperties.set(propertyName, typeName);
    }
    for (const element of parameter.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const propertyName = element.propertyName
        ? staticPropertyName(element.propertyName)
        : element.name.text;
      if (propertyName && typedProperties.has(propertyName)) atoms.add(element.name.text);
    }
  }
}

/** Recognizes destructured scope props annotated as `typeof someScope`. */
function collectTypedScopeProps(
  node: ts.FunctionLikeDeclarationBase,
  knownScopes: ReadonlySet<string>,
  scopes: Set<string>,
): void {
  for (const parameter of node.parameters) {
    if (!ts.isObjectBindingPattern(parameter.name) || !parameter.type || !ts.isTypeLiteralNode(parameter.type)) {
      continue;
    }
    const typedProperties = new Set<string>();
    for (const member of parameter.type.members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name || !ts.isTypeQueryNode(member.type)) continue;
      const propertyName = staticPropertyName(member.name);
      const typeName = ts.isIdentifier(member.type.exprName) ? member.type.exprName.text : undefined;
      if (propertyName && typeName && knownScopes.has(typeName)) typedProperties.add(propertyName);
    }
    for (const element of parameter.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const propertyName = element.propertyName
        ? staticPropertyName(element.propertyName)
        : element.name.text;
      if (propertyName && typedProperties.has(propertyName)) scopes.add(element.name.text);
    }
  }
}

function diagnostic(node: ts.Node, category: ReactJsxDiagnostic["category"], message: string): ReactJsxDiagnostic {
  return { category, message, start: node.getStart(), length: node.getWidth() };
}

/**
 * React may discard a development Strict Mode render before it commits. Local
 * Streamix factories are therefore allowed to construct reactive objects but
 * not to start observable work while computing their initial configuration.
 * This deliberately conservative check catches the common unsafe forms while
 * allowing literals, identifiers, property reads, and nested Streamix
 * construction.
 */
function reportLocalFactoryImpurity(
  factoryCall: ts.CallExpression,
  diagnostics: ReactJsxDiagnostic[],
): void {
  const knownPureFactories = new Set([
    "atom", "scope", "derived", "flow", "method", "derivedExpr", "flowExpr",
  ]);
  let impurity: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (impurity || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
      if (!knownPureFactories.has(name ?? "")) {
        impurity = node;
        return;
      }
    }
    if (
      ts.isNewExpression(node) ||
      ts.isAwaitExpression(node) ||
      ts.isYieldExpression(node) ||
      ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind) ||
      ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) ||
      ts.isPostfixUnaryExpression(node)
    ) {
      impurity = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const argument of factoryCall.arguments) visit(argument);
  if (impurity) {
    diagnostics.push(diagnostic(
      impurity,
      "error",
      "Component-local reactive initialization must be render-pure. Move this work to an effect, event, route loader, or explicit resource preload.",
    ));
  }
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken || compoundOperator(ts.factory, kind) !== undefined || isLogicalAssignment(kind);
}

function staticPropertyName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function atomFromMapAccess(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string | undefined {
  if (!ts.isIdentifier(expression.expression)) return undefined;
  const map = atomMaps.get(expression.expression.text);
  if (!map) return undefined;
  const key = ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : expression.argumentExpression && (ts.isStringLiteral(expression.argumentExpression) || ts.isNumericLiteral(expression.argumentExpression))
      ? expression.argumentExpression.text
      : undefined;
  return key ? map.get(key) : undefined;
}

function atomReferenceName(
  expression: ts.Expression,
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string | undefined {
  if (ts.isIdentifier(expression)) return atoms.has(expression.text) ? expression.text : undefined;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return atomFromMapAccess(expression, atomMaps);
  }
  return undefined;
}

/**
 * The base identifier of an element access on a known atom map when the key
 * cannot be statically resolved to one of its known atom entries. Such a
 * write can never be lowered onto the atom — `.value` is getter-only, and
 * plain JavaScript would silently replace the atom reference — so the
 * component pass reports it and the lvalue keeps its authored form.
 */
function unresolvedAtomMapAccessBase(
  expression: ts.Expression,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): ts.Identifier | undefined {
  if (!ts.isElementAccessExpression(expression) || !ts.isIdentifier(expression.expression)) return undefined;
  if (!atomMaps.has(expression.expression.text)) return undefined;
  return atomFromMapAccess(expression, atomMaps) ? undefined : expression.expression;
}

interface DestructuredAtomTarget {
  readonly atomName: string;
  readonly key: string | number;
  /** False when a destructuring member is not a known atom target. */
  readonly known: boolean;
}

function destructuredAtomTargets(
  pattern: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): DestructuredAtomTarget[] {
  const targets: DestructuredAtomTarget[] = [];
  if (ts.isArrayLiteralExpression(pattern)) {
    pattern.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      const atomName = ts.isExpression(element) ? atomReferenceName(element, atoms, atomMaps) : undefined;
      targets.push(atomName ? { atomName, key: index, known: true } : { atomName: "", key: index, known: false });
    });
    return targets;
  }
  for (const property of pattern.properties) {
    const key = ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property)
      ? staticPropertyName(property.name)
      : undefined;
    const target = ts.isShorthandPropertyAssignment(property)
      ? property.name
      : ts.isPropertyAssignment(property) && ts.isExpression(property.initializer)
        ? property.initializer
        : undefined;
    const atomName = key && target ? atomReferenceName(target, atoms, atomMaps) : undefined;
    targets.push(atomName && key !== undefined
      ? { atomName, key, known: true }
      : { atomName: "", key: key ?? "", known: false });
  }
  return targets;
}

function writeDestructuredAtoms(
  factory: ts.NodeFactory,
  right: ts.Expression,
  targets: readonly DestructuredAtomTarget[],
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  context: ts.TransformationContext,
): ts.CallExpression {
  const value = factory.createUniqueName("__streamixAssigned");
  const statements: ts.Statement[] = [
    factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
      factory.createVariableDeclaration(value, undefined, undefined, rewriteAtomReads(right, atoms, atomMaps, context)),
    ], ts.NodeFlags.Const)),
  ];
  for (const target of targets) {
    const property = typeof target.key === "number"
      ? factory.createElementAccessExpression(value, factory.createNumericLiteral(target.key))
      : factory.createPropertyAccessExpression(value, target.key);
    statements.push(factory.createExpressionStatement(writeAtom(
      factory,
      factory.createIdentifier(target.atomName),
      property,
    )));
  }
  statements.push(factory.createReturnStatement(value));
  return factory.createCallExpression(
    factory.createParenthesizedExpression(factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock(statements, true),
    )),
    undefined,
    [],
  );
}

function writeAtom(factory: ts.NodeFactory, atomName: ts.Identifier, value: ts.Expression): ts.CallExpression {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(atomName, "next"),
    undefined,
    [value],
  );
}

/** Preserves JavaScript prefix/postfix update result semantics in an IIFE. */
function updateAtom(
  factory: ts.NodeFactory,
  atomName: string,
  increment: boolean,
  postfix: boolean,
): ts.CallExpression {
  const previous = factory.createUniqueName("__streamixPrevious");
  const atom = factory.createIdentifier(atomName);
  const nextValue = factory.createBinaryExpression(
    previous,
    increment ? factory.createToken(ts.SyntaxKind.PlusToken) : factory.createToken(ts.SyntaxKind.MinusToken),
    factory.createNumericLiteral(1),
  );
  return factory.createCallExpression(
    factory.createParenthesizedExpression(factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock([
        factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(previous, undefined, undefined, factory.createPropertyAccessExpression(atom, "value")),
        ], ts.NodeFlags.Const)),
        factory.createExpressionStatement(writeAtom(factory, atom, nextValue)),
        factory.createReturnStatement(postfix ? previous : nextValue),
      ], true),
    )),
    undefined,
    [],
  );
}

function compoundOperator(factory: ts.NodeFactory, kind: ts.SyntaxKind): ts.BinaryOperatorToken | undefined {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken: return factory.createToken(ts.SyntaxKind.PlusToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.MinusEqualsToken: return factory.createToken(ts.SyntaxKind.MinusToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.AsteriskEqualsToken: return factory.createToken(ts.SyntaxKind.AsteriskToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.SlashEqualsToken: return factory.createToken(ts.SyntaxKind.SlashToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.PercentEqualsToken: return factory.createToken(ts.SyntaxKind.PercentToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.AmpersandEqualsToken: return factory.createToken(ts.SyntaxKind.AmpersandToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.BarEqualsToken: return factory.createToken(ts.SyntaxKind.BarToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.CaretEqualsToken: return factory.createToken(ts.SyntaxKind.CaretToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken: return factory.createToken(ts.SyntaxKind.AsteriskAsteriskToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.LessThanLessThanEqualsToken: return factory.createToken(ts.SyntaxKind.LessThanLessThanToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken: return factory.createToken(ts.SyntaxKind.GreaterThanGreaterThanToken) as ts.BinaryOperatorToken;
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken: return factory.createToken(ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) as ts.BinaryOperatorToken;
    default: return undefined;
  }
}

/** True for the short-circuiting assignment operators. */
function isLogicalAssignment(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken;
}

/**
 * Lowers `atom &&= right`, `atom ||= right`, and `atom ??= right` while
 * preserving JavaScript's short-circuit and result semantics: the right side
 * runs only when the operator's condition assigns, and the expression evaluates
 * to the atom's value afterwards. The conditional form keeps the right side in
 * the enclosing expression; a generated synchronous arrow would make `await`
 * and `yield` invalid in async and generator functions.
 */
function writeLogicalAtom(
  factory: ts.NodeFactory,
  atomName: string,
  kind: ts.SyntaxKind,
  right: ts.Expression,
): ts.BinaryExpression {
  const atom = factory.createIdentifier(atomName);
  const value = () => factory.createPropertyAccessExpression(factory.createIdentifier(atomName), "value");
  const operator = kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
    ? ts.SyntaxKind.AmpersandAmpersandToken
    : kind === ts.SyntaxKind.BarBarEqualsToken
      ? ts.SyntaxKind.BarBarToken
      : ts.SyntaxKind.QuestionQuestionToken;
  const write = factory.createParenthesizedExpression(factory.createBinaryExpression(
    writeAtom(factory, atom, right),
    factory.createToken(ts.SyntaxKind.CommaToken),
    value(),
  ));
  return factory.createBinaryExpression(value(), factory.createToken(operator), write);
}

function rewriteAtomReads(
  expression: ts.Expression,
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  context: ts.TransformationContext,
  lexicalOrigin: ts.Node = expression,
  isHidden?: (id: ts.Identifier) => boolean,
): ts.Expression {
  let boundary: ts.Node | undefined = lexicalOrigin.parent;
  while (boundary && !ts.isFunctionLike(boundary) && !ts.isSourceFile(boundary)) boundary = boundary.parent;
  // Component-aware resolution must include the handler's own locals and
  // parameters; the nearest function boundary alone can miss those shadows.
  const shadowed = (id: ts.Identifier) => isHidden
    ? isHidden(id)
    : isShadowedName(id.text, id, boundary ?? expression);
  const visitor: ts.Visitor = (node) => {
    // Keep invalid read-only lvalues intact; the original assignment has a
    // compiler diagnostic and must not be changed into a property write.
    if (ts.isBinaryExpression(node) && isAtomWriteOperator(node.operatorToken.kind) &&
        atomReferenceName(node.left, atoms, atomMaps)) return node;
    // An atom-map write whose key cannot be statically resolved to a known
    // entry keeps its authored lvalue: appending `.value` would write a
    // getter-only accessor. The component pass has reported the write; the
    // right side is still an ordinary read position.
    if (ts.isBinaryExpression(node) && isAtomWriteOperator(node.operatorToken.kind)) {
      const base = unresolvedAtomMapAccessBase(node.left, atomMaps);
      if (base && !shadowed(base)) {
        const right = ts.visitNode(node.right, visitor) as ts.Expression;
        return right === node.right ? node :
          context.factory.updateBinaryExpression(node, node.left, node.operatorToken, right);
      }
    }
    // Only increment/decrement stay untouched: they are writes, and lowering
    // their operand would produce an invalid `.value++` on the atom. Pure
    // read operators (`!`, `-`, `+`, `~`, `typeof`) must descend, or a
    // boolean toggle like `atom = !atom` keeps reading the atom object and
    // always writes `false`.
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
        atomReferenceName(node.operand, atoms, atomMaps)) return node;
    // Same contract for increment and decrement on an unresolvable atom-map
    // entry; the update has no value side to preserve.
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      const base = unresolvedAtomMapAccessBase(node.operand, atomMaps);
      if (base && !shadowed(base)) return node;
    }
    // An explicit `.value` read already observes the atom's current value.
    // Leave the whole expression untouched; descending would produce a
    // nonsensical second `.value` on the resolved value.
    if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === "value" || node.name.text === "next" || node.name.text === "subscribe" || node.name.text === "dispose") &&
      atomReferenceName(node.expression, atoms, atomMaps)
    ) {
      return node;
    }
    // Object shorthand is both a value read and a property name. Expanding it
    // avoids generating the invalid `{ value.value }` form.
    if (ts.isShorthandPropertyAssignment(node) && atoms.has(node.name.text) &&
        !shadowed(node.name)) {
      return context.factory.createPropertyAssignment(
        node.name,
        context.factory.createPropertyAccessExpression(node.name, "value"),
      );
    }
    if (ts.isIdentifier(node) && atoms.has(node.text) && !isNamePosition(node) &&
        !shadowed(node)) {
      return context.factory.createPropertyAccessExpression(node, "value");
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        ts.isIdentifier(node.expression) && !shadowed(node.expression)) {
      const atomName = atomFromMapAccess(node, atomMaps);
      if (atomName) return context.factory.createPropertyAccessExpression(context.factory.createIdentifier(atomName), "value");
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        atomMaps.has(node.expression.text)
      ) {
        return context.factory.createPropertyAccessExpression(node, "value");
      }
    }
    return ts.visitEachChild(node, visitor, context);
  };
  return ts.visitNode(expression, visitor) as ts.Expression;
}

function updateFunctionLike<T extends ts.FunctionLikeDeclarationBase>(
  factory: ts.NodeFactory,
  node: T,
  body: ts.Block,
): T {
  if (ts.isFunctionDeclaration(node)) {
    return factory.updateFunctionDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      body,
    ) as unknown as T;
  }
  if (ts.isArrowFunction(node)) {
    return factory.updateArrowFunction(
      node,
      node.modifiers,
      node.typeParameters,
      node.parameters,
      node.type,
      node.equalsGreaterThanToken,
      body,
    ) as unknown as T;
  }
  if (ts.isFunctionExpression(node)) return factory.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body) as unknown as T;
  return node;
}
