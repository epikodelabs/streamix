import ts from 'typescript';
import { createTokenSourceMap } from './source-map';

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
  if (ts.isBlock(node) || ts.isSourceFile(node)) {
    for (const stmt of node.statements) {
      if (ts.isVariableStatement(stmt)) for (const declaration of stmt.declarationList.declarations) boundNames(declaration.name, names);
      if (ts.isFunctionDeclaration(stmt) && stmt.name) names.add(stmt.name.text);
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
function factoryKind(
  node: ts.Expression,
  imports: FactoryImports,
  checker?: ts.TypeChecker,
): string | undefined {
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
      hidden: (site: ts.Identifier) => boolean = () => false,
    ): ts.CallExpression => {
      if (!call.arguments.length || !(ts.isArrowFunction(call.arguments[0]) || ts.isFunctionExpression(call.arguments[0]))) return call;
      const callback = call.arguments[0];
      const callbackParameters = new Set<string>();
      for (const parameter of callback.parameters) boundNames(parameter.name, callbackParameters);
      const canRead = (id: ts.Identifier): boolean => reactiveNames.has(id.text) &&
        !callbackParameters.has(id.text) && !hidden(id) && !isShadowedName(id.text, id, boundary);
      const lower: ts.Visitor = child => {
        if (ts.isPropertyAccessExpression(child) && child.name.text === "value" &&
            ts.isIdentifier(child.expression) && canRead(child.expression)) return child;
        if (ts.isShorthandPropertyAssignment(child) && canRead(child.name)) {
          return factory.createPropertyAssignment(child.name, factory.createPropertyAccessExpression(child.name, "value"));
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
        return lowerDerivedCallback(node, moduleAtoms, sourceFile);
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
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
            continue;
          }
          {
            const kind = factoryKind(declaration.initializer, imports, checker);
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
              if (isComponent) reportLocalFactoryImpurity(declaration.initializer, diagnostics);
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
              if (isComponent) reportLocalFactoryImpurity(declaration.initializer, diagnostics);
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
      for (const statement of functionBody.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const names = new Set<string>(); boundNames(declaration.name, names);
          for (const name of names) {
            if (!atomMaps.has(name) && !localReactiveDeclarations.has(declaration) &&
                !(ts.isIdentifier(declaration.name) && declaration.initializer && ts.isIdentifier(declaration.initializer) && atoms.has(declaration.initializer.text)) &&
                !(ts.isObjectBindingPattern(declaration.name) && atoms.has(name))) {
              plainShadowed.add(name);
            }
          }
        }
      }
      const isHidden = (site: ts.Identifier): boolean => plainShadowed.has(site.text) || isShadowed(site, node);
      const isHiddenTarget = (site: ts.Expression): boolean => {
        let base: ts.Expression = site;
        while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) base = base.expression;
        return ts.isIdentifier(base) && isHidden(base);
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
      const bindingForAtom = (atomName: string, _source: ts.Node): ts.Identifier => {
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
        const bindingKey = `${scopeName}.${property}`;
        const existing = scopeBindings.get(bindingKey);
        if (existing) return existing;
        const name = factory.createIdentifier(`__streamixBinding${bindingCount++}`);
        scopeBindings.set(bindingKey, name);
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
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(factory.createIdentifier(scopeName), "get"),
                    undefined,
                    [factory.createStringLiteral(property)],
                  ),
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

      const visit: ts.Visitor = (child) => {
        if (ts.isCallExpression(child) && factoryKind(child, imports, checker) === "derived") {
          return lowerDerivedCallback(child, atoms, node, isHidden);
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
            const readOnly = targets.find(target => !writableBindings.has(target.atomName));
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
        if (ts.isBinaryExpression(child) && isAtomWriteOperator(child.operatorToken.kind) &&
            !isHiddenTarget(child.left) && atomReferenceName(child.left, atoms, atomMaps)) {
          const atomName = atomReferenceName(child.left, atoms, atomMaps)!;
          if (!writableBindings.has(atomName)) {
            diagnostics.push(diagnostic(child, "error", `Cannot assign to read-only atom binding \"${atomName}\". Declare it with let or call ${atomName}.next(value).`));
            return child;
          }
          if (child.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            return writeAtom(factory, factory.createIdentifier(atomName), rewriteAtomReads(child.right, atoms, atomMaps, context));
          }
          const operator = compoundOperator(factory, child.operatorToken.kind);
          if (operator !== undefined) {
            return writeAtom(
              factory,
              factory.createIdentifier(atomName),
              factory.createBinaryExpression(
                factory.createPropertyAccessExpression(factory.createIdentifier(atomName), "value"),
                operator,
                rewriteAtomReads(child.right, atoms, atomMaps, context),
              ),
            );
          }
          if (isLogicalAssignment(child.operatorToken.kind)) {
            return writeLogicalAtom(
              factory,
              atomName,
              child.operatorToken.kind,
              rewriteAtomReads(child.right, atoms, atomMaps, context),
              isJavaScript,
            );
          }
          // The operator table and the write-operator predicate disagree;
          // leaving the statement unrewritten would write the atom object
          // itself instead of emitting a value.
          diagnostics.push(diagnostic(child, "error", `Compound write "${child.operatorToken.getText(sourceFile)}" cannot be lowered for atom \"${atomName}\". Write ${atomName}.next(...) explicitly.`));
          return child;
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
        }

        if (ts.isJsxExpression(child) && child.expression) {
          if (ts.isArrowFunction(child.expression) || ts.isFunctionExpression(child.expression)) {
            const lowered = ts.visitNode(child.expression, visit) as ts.Expression;
            return factory.updateJsxExpression(child, rewriteAtomReads(lowered, atoms, atomMaps, context, child.expression));
          }
          if (isSharedAtomComponentProp(child, atoms, atomMaps)) {
            return child;
          }
          return factory.updateJsxExpression(child, rewriteJsxValue(child.expression));
        }

        return ts.visitEachChild(child, visit, context);
      };

      const body = ts.visitEachChild(functionBody, visit, context) as ts.Block;
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
          [factory.createArrowFunction(
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
          )],
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
      if (ts.isCallExpression(expr) && expr.arguments.length > 0 && isReactWrapper(expr.expression)) {
        const first = transformInitializer(expr.arguments[0], traceName);
        return first === expr.arguments[0] ? expr : factory.updateCallExpression(expr, expr.expression, expr.typeArguments, [first, ...expr.arguments.slice(1)]);
      }
      return expr;
    };
    return file => {
      const statements = file.statements.map(statement => {
        if (ts.isFunctionDeclaration(statement)) {
          const isDefault = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
          return transformFunction(statement, isDefault ? "DefaultExport" : statement.name?.text);
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
          return factory.updateVariableStatement(statement, statement.modifiers,
            factory.updateVariableDeclarationList(statement.declarationList, declarations));
        }
        if (ts.isExportAssignment(statement)) {
          const expr = transformInitializer(statement.expression, statement.isExportEquals ? undefined : "DefaultExport");
          return expr === statement.expression ? statement : factory.updateExportAssignment(statement, statement.modifiers, expr);
        }
        return statement;
      });
      return factory.updateSourceFile(file, statements);
    };
  };

  // A class component cannot safely adopt compiler-generated React hooks.
  // Report it rather than silently leaving live atoms as JSX children.
  const inspectSkipped = (node: ts.Node): void => {
    // Nested components have their own hook lifetime. Transforming only the
    // outer component would leave their implicit reads unbound, while blindly
    // lifting hooks into the parent would violate React's Rules of Hooks.
    if (node.parent !== sourceFile && (
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
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text) &&
        node.initializer && ts.isCallExpression(node.initializer) && !isReactWrapper(node.initializer.expression)) {
      let unsafeJsx = false;
      const check = (child: ts.Node): void => {
        if (ts.isJsxExpression(child) && child.expression) {
          const value = child.expression;
          if (ts.isIdentifier(value) && moduleAtoms.has(value.text)) unsafeJsx = true;
          if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) && moduleScopes.has(value.expression.text)) unsafeJsx = true;
        }
        ts.forEachChild(child, check);
      };
      ts.forEachChild(node.initializer, check);
      if (unsafeJsx) diagnostics.push(diagnostic(node.name, "error",
        `Component ${node.name.text} uses an unrecognized wrapper around reactive JSX. Use React.memo/forwardRef imports or an explicit hook.`));
    }
    if (ts.isClassDeclaration(node) && node.name) {
      // Inspect JSX syntax, not class source text. A string/comment containing
      // "count" or a member `this.count` is not an implicit atom read.
      let unsafeJsx = false;
      const inspect = (child: ts.Node): void => {
        if (ts.isJsxExpression(child) && child.expression &&
            !isSharedAtomComponentProp(child, moduleAtoms, moduleAtomMaps)) {
          const inspectExpression = (value: ts.Node): void => {
            if (ts.isIdentifier(value) && !isNamePosition(value) &&
                !isShadowedName(value.text, value, node) &&
                (moduleAtoms.has(value.text) || moduleScopes.has(value.text))) {
              unsafeJsx = true;
            }
            ts.forEachChild(value, inspectExpression);
          };
          inspectExpression(child.expression);
        }
        ts.forEachChild(child, inspect);
      };
      ts.forEachChild(node, inspect);
      if (unsafeJsx) diagnostics.push(diagnostic(node.name, "error",
        `Class component ${node.name.text} cannot be adopted. Use an explicit useAtomValue hook in a function component.`));
    }
    ts.forEachChild(node, inspectSkipped);
  };
  inspectSkipped(sourceFile);
  const transformed = ts.transform(sourceFile, [transformer]).transformed[0] as ts.SourceFile;
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const printed = printer.printFile(transformed);
  const directive = printed.match(/^(\s*["']use client["'];?\s*\n)/);
  const code = needsRuntimeImport && /\b(?:useStreamixSource|useStreamixLocal|useStreamixAfterCommit)\s*\(/.test(printed) ? (directive
    ? `${directive[0]}${runtimePreludeFor(printed)}\n${printed.slice(directive[0].length)}`
    : `${runtimePreludeFor(printed)}\n${printed}`) : printed;
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
  return `import { ${names.join(", ")} } from "@epikodelabs/streamix/react";`;
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
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      if (factoryKind(declaration.initializer, imports, checker) === factoryName) {
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
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      if (["atom", "derived", "flow"].includes(factoryKind(declaration.initializer, imports, checker) ?? "")) {
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
 * preserving JavaScript's short-circuit and result semantics: the atom only
 * emits when the operator's condition assigns, and the expression evaluates to
 * the atom's value afterwards.
 */
function writeLogicalAtom(
  factory: ts.NodeFactory,
  atomName: string,
  kind: ts.SyntaxKind,
  right: ts.Expression,
  isJavaScript: boolean,
): ts.CallExpression {
  const atom = factory.createIdentifier(atomName);
  const current = factory.createUniqueName("__streamixCurrent");
  const condition = kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
    ? current as ts.Expression
    : kind === ts.SyntaxKind.BarBarEqualsToken
      ? factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, current as ts.Expression)
      : factory.createBinaryExpression(
          factory.createBinaryExpression(
            factory.createParenthesizedExpression(isJavaScript ? current : factory.createAsExpression(current, factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))),
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createNull(),
          ),
          factory.createToken(ts.SyntaxKind.BarBarToken),
          factory.createBinaryExpression(
            factory.createParenthesizedExpression(isJavaScript ? current : factory.createAsExpression(current, factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))),
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createIdentifier("undefined"),
          ),
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
          factory.createVariableDeclaration(current, undefined, undefined, factory.createPropertyAccessExpression(atom, "value")),
        ], ts.NodeFlags.Const)),
        factory.createIfStatement(
          condition,
          factory.createBlock([
            factory.createExpressionStatement(writeAtom(factory, atom, right)),
            factory.createReturnStatement(factory.createPropertyAccessExpression(atom, "value")),
          ]),
          factory.createBlock([
            factory.createReturnStatement(current as ts.Expression),
          ]),
        ),
      ], true),
    )),
    undefined,
    [],
  );
}

function rewriteAtomReads(
  expression: ts.Expression,
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  context: ts.TransformationContext,
  lexicalOrigin: ts.Node = expression,
): ts.Expression {
  let boundary: ts.Node | undefined = lexicalOrigin.parent;
  while (boundary && !ts.isFunctionLike(boundary) && !ts.isSourceFile(boundary)) boundary = boundary.parent;
  const shadowed = (id: ts.Identifier) => isShadowedName(id.text, id, boundary ?? expression);
  const visitor: ts.Visitor = (node) => {
    // Keep invalid read-only lvalues intact; the original assignment has a
    // compiler diagnostic and must not be changed into a property write.
    if (ts.isBinaryExpression(node) && isAtomWriteOperator(node.operatorToken.kind) &&
        atomReferenceName(node.left, atoms, atomMaps)) return node;
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        atomReferenceName(node.operand, atoms, atomMaps)) return node;
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
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
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
