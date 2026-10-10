import ts from 'typescript';

export interface ReactJsxTransformResult {
  /** Transformed TypeScript/TSX source. */
  readonly code: string;
  /** Number of reactive JSX bindings introduced by the transform. */
  readonly bindingCount: number;
  /** Diagnostics for syntax that cannot receive a safe implicit rewrite. */
  readonly diagnostics: readonly ReactJsxDiagnostic[];
  /** Statement-anchored original-source map for downstream bundler composition. */
  readonly sourceMap?: ReactJsxSourceMap;
}

export interface ReactJsxSourceMap {
  readonly version: 3;
  readonly file: string;
  readonly sources: readonly string[];
  readonly sourcesContent: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

interface SourceMapAnchor {
  readonly statement: ts.Statement;
  readonly source: ts.Node;
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
  const lines = source.split(/\r?\n/);
  return diagnostics.map(diagnostic => {
    let offset = 0;
    let lineIndex = 0;
    while (lineIndex < lines.length && offset + lines[lineIndex].length + 1 <= diagnostic.start) {
      offset += lines[lineIndex].length + 1;
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
export function transformReactJsx(source: string, fileName = "component.tsx"): ReactJsxTransformResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let bindingCount = 0;
  let needsRuntimeImport = false;
  const diagnostics: ReactJsxDiagnostic[] = [];
  const sourceMapAnchors: SourceMapAnchor[] = [];
  const moduleAtoms = new Set([
    ...collectModuleBindings(sourceFile, "atom"),
    ...collectModuleBindings(sourceFile, "derived"),
    ...collectModuleBindings(sourceFile, "flow"),
  ]);
  const moduleScopes = collectModuleBindings(sourceFile, "scope");
  const moduleWritableAtoms = collectModuleWritableBindings(sourceFile);
  const moduleAtomMaps = collectModuleAtomMaps(sourceFile, moduleAtoms, moduleWritableAtoms);

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const factory = context.factory;

    const transformFunction = <T extends ts.FunctionLikeDeclarationBase>(node: T): T => {
      if (!node.body || !ts.isBlock(node.body)) return node;

      const atoms = new Set<string>(moduleAtoms);
      const scopes = new Set<string>(moduleScopes);
      // A map records only locally-created object literals whose entries are
      // known atom references. It lets `model.count` and `{ count } = model`
      // retain the source identity without guessing about arbitrary objects.
      const atomMaps = new Map(moduleAtomMaps);
      const writableBindings = new Set<string>(moduleWritableAtoms);
      const localReactiveDeclarations = new Set<ts.VariableDeclaration>();
      let insertionIndex = 0;

      // A destructured prop explicitly typed as `typeof someAtom` is a shared
      // atom reference at this component boundary. This keeps the receiving
      // component compiler-first too: `<Editor source={title} />` can render
      // `{source}` without a manual `.value` read.
      collectTypedAtomProps(node, moduleAtoms, atoms);
      collectTypedScopeProps(node, moduleScopes, scopes);

      node.body.statements.forEach((statement, index) => {
        if (!ts.isVariableStatement(statement)) return;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
            continue;
          }
          if (ts.isIdentifier(declaration.initializer.expression)) {
            if (["atom", "derived", "flow"].includes(declaration.initializer.expression.text)) {
              atoms.add(declaration.name.text);
              localReactiveDeclarations.add(declaration);
              reportLocalFactoryImpurity(declaration.initializer, diagnostics);
              if ((statement.declarationList.flags & ts.NodeFlags.Let) !== 0) writableBindings.add(declaration.name.text);
            }
            if (declaration.initializer.expression.text === "scope") {
              scopes.add(declaration.name.text);
              localReactiveDeclarations.add(declaration);
              reportLocalFactoryImpurity(declaration.initializer, diagnostics);
            }
          }
        }
        if (atoms.size > 0 || scopes.size > 0) insertionIndex = index + 1;
      });

      // Static aliases retain atom identity. Object maps are supported only
      // when every property is a known atom reference; arbitrary objects stay
      // ordinary JavaScript and are never guessed to be reactive.
      let changed = true;
      while (changed) {
        changed = false;
        for (const statement of node.body.statements) {
          if (!ts.isVariableStatement(statement)) continue;
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
              if (entries.size > 0) atomMaps.set(declaration.name.text, entries);
            }
            if (
              ts.isObjectBindingPattern(declaration.name) &&
              ts.isIdentifier(declaration.initializer) &&
              atomMaps.has(declaration.initializer.text)
            ) {
              const map = atomMaps.get(declaration.initializer.text)!;
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
              }
            }
          }
        }
      }

      if (atoms.size === 0 && scopes.size === 0) return node;

      const bindings: ts.Statement[] = [];
      const atomBindings = new Map<string, ts.Identifier>();
      const scopeBindings = new Map<string, ts.Identifier>();
      const bindingForAtom = (atomName: string, source: ts.Node): ts.Identifier => {
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
              factory.createAsExpression(
              factory.createCallExpression(factory.createIdentifier("__streamixUse"), undefined, [
                  factory.createIdentifier(atomName),
                factory.createStringLiteral(atomName),
                ]),
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
              ),
            ),
          ], ts.NodeFlags.Const),
        );
        bindings.push(statement);
        sourceMapAnchors.push({ statement, source });
        return name;
      };
      const bindingForSource = (atomSource: ts.Expression, key: string, source: ts.Node = atomSource): ts.Identifier => {
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
              factory.createAsExpression(
                factory.createCallExpression(factory.createIdentifier("__streamixUse"), undefined, [
                  atomSource,
                  factory.createStringLiteral(key),
                ]),
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
              ),
            ),
          ], ts.NodeFlags.Const),
        );
        bindings.push(statement);
        sourceMapAnchors.push({ statement, source });
        return name;
      };
      const bindingForScope = (scopeName: string, property: string, source: ts.Node): ts.Identifier => {
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
              factory.createAsExpression(
                factory.createCallExpression(factory.createIdentifier("__streamixUse"), undefined, [
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(factory.createIdentifier(scopeName), "get"),
                    undefined,
                    [factory.createStringLiteral(property)],
                  ),
                  factory.createStringLiteral(`${scopeName}.${property}`),
                ]),
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
              ),
            ),
          ], ts.NodeFlags.Const),
        );
        bindings.push(statement);
        sourceMapAnchors.push({ statement, source });
        return name;
      };
      const rewriteJsxValue = (expression: ts.Expression): ts.Expression => {
        const jsxValueVisitor: ts.Visitor = (value) => {
          if (ts.isIdentifier(value) && atoms.has(value.text)) {
            return bindingForAtom(value.text, value);
          }
          if (
            ts.isPropertyAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            atomMaps.has(value.expression.text) &&
            atomFromMapAccess(value, atomMaps)
          ) {
            return bindingForAtom(atomFromMapAccess(value, atomMaps)!, value);
          }
          if (
            ts.isElementAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            atomMaps.has(value.expression.text)
          ) {
            return bindingForSource(value, value.getText(sourceFile));
          }
          if (
            ts.isPropertyAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            scopes.has(value.expression.text)
          ) {
            return bindingForScope(value.expression.text, value.name.text, value);
          }
          if (
            ts.isElementAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            scopes.has(value.expression.text) &&
            value.argumentExpression &&
            (ts.isStringLiteral(value.argumentExpression) || ts.isNumericLiteral(value.argumentExpression))
          ) {
            return bindingForScope(value.expression.text, value.argumentExpression.text, value);
          }
          if (
            ts.isElementAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            scopes.has(value.expression.text)
          ) {
            diagnostics.push(diagnostic(value, "error", "Dynamic scope-field reads are ambiguous. Use scope.get(key) with an explicit runtime boundary."));
            return value;
          }
          if (
            ts.isConditionalExpression(value) &&
            ts.isIdentifier(value.whenTrue) &&
            ts.isIdentifier(value.whenFalse) &&
            atoms.has(value.whenTrue.text) &&
            atoms.has(value.whenFalse.text)
          ) {
            return bindingForSource(value, value.getText(sourceFile));
          }
          return ts.visitEachChild(value, jsxValueVisitor, context);
        };
        return ts.visitNode(expression, jsxValueVisitor) as ts.Expression;
      };

      const visit: ts.Visitor = (child) => {
        if (ts.isVariableDeclaration(child) && localReactiveDeclarations.has(child) && child.initializer) {
          needsRuntimeImport = true;
          return factory.updateVariableDeclaration(
            child,
            child.name,
            child.exclamationToken,
            child.type,
            factory.createCallExpression(factory.createIdentifier("__streamixLocal"), undefined, [
              factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                child.initializer,
              ),
            ]),
          );
        }
        if (
          ts.isBinaryExpression(child) &&
          child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          (ts.isObjectLiteralExpression(child.left) || ts.isArrayLiteralExpression(child.left))
        ) {
          const targets = destructuredAtomTargets(child.left, atoms, atomMaps);
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
        if (ts.isBinaryExpression(child) && atomReferenceName(child.left, atoms, atomMaps)) {
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
        }
        if (ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) {
          const operand = child.operand;
          const atomName = atomReferenceName(operand, atoms, atomMaps);
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
            return ts.visitEachChild(child, visit, context);
          }
          if (isSharedAtomComponentProp(child, atoms)) {
            return child;
          }
          return factory.updateJsxExpression(child, rewriteJsxValue(child.expression));
        }

        return ts.visitEachChild(child, visit, context);
      };

      const body = ts.visitEachChild(node.body, visit, context) as ts.Block;
      if (bindings.length === 0) {
        return node;
      }

      // Trace only after React commits. Recording while the function body is
      // evaluated would itself be an observable render-phase side effect and
      // would lie for interrupted concurrent renders.
      if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) {
        bindings.push(factory.createExpressionStatement(factory.createCallExpression(
          factory.createIdentifier("__streamixUseEffect"),
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
                [factory.createStringLiteral("render"), factory.createStringLiteral(node.name.text)],
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

    return (file) => {
      const statements = file.statements.map((statement) => {
        if (ts.isFunctionDeclaration(statement)) return transformFunction(statement);
        if (ts.isVariableStatement(statement)) {
          return ts.visitEachChild(statement, (child) => {
            if (ts.isArrowFunction(child)) return transformFunction(child);
            return child;
          }, context) as ts.VariableStatement;
        }
        return statement;
      });

      return factory.updateSourceFile(file, statements);
    };
  };

  const transformed = ts.transform(sourceFile, [transformer]).transformed[0] as ts.SourceFile;
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const printed = printer.printFile(transformed);
  const code = needsRuntimeImport ? `${runtimePrelude}\n${printed}` : printed;
  return {
    code,
    bindingCount,
    diagnostics,
    sourceMap: createStatementSourceMap(sourceFile, transformed, printer, printed, code, sourceMapAnchors),
  };
}

/**
 * Emits original-source anchors for each printed top-level statement. The
 * prelude and compiler-created expressions intentionally remain unmapped;
 * their code is not authored by the user. Bundlers can compose these anchors
 * with their normal TSX/JS maps without pointing diagnostics at the virtual
 * preprocessing directory.
 */
function createStatementSourceMap(
  original: ts.SourceFile,
  transformed: ts.SourceFile,
  printer: ts.Printer,
  printed: string,
  code: string,
  compilerAnchors: readonly SourceMapAnchor[],
): ReactJsxSourceMap {
  const mapLines = new Map<number, Array<{ generatedColumn: number; line: number; column: number }>>();
  const addAnchor = (generatedOffset: number, source: ts.Node): void => {
    if (source.pos < 0) return;
    const originalPosition = original.getLineAndCharacterOfPosition(source.getStart(original));
    const generated = lineAndColumnAt(code, generatedOffset);
    const line = mapLines.get(generated.line) ?? [];
    line.push({ generatedColumn: generated.column, line: originalPosition.line, column: originalPosition.character });
    mapLines.set(generated.line, line);
  };
  let searchFrom = 0;
  const printedOffset = code.lastIndexOf(printed);
  for (const statement of transformed.statements) {
    const emitted = printer.printNode(ts.EmitHint.Unspecified, statement, transformed);
    const position = printed.indexOf(emitted, searchFrom);
    if (position < 0) continue;
    searchFrom = position + emitted.length;
    addAnchor(printedOffset + position, ts.getOriginalNode(statement));
  }
  for (const anchor of compilerAnchors) {
    const emitted = printer.printNode(ts.EmitHint.Unspecified, anchor.statement, transformed);
    const position = code.indexOf(emitted);
    if (position >= 0) addAnchor(position, anchor.source);
  }
  return {
    version: 3,
    file: original.fileName,
    sources: [original.fileName],
    sourcesContent: [original.text],
    names: [],
    mappings: encodeLineMappings(mapLines),
  };
}

function lineAndColumnAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: offset - (lastNewline + 1) };
}

function encodeLineMappings(lines: ReadonlyMap<number, readonly { generatedColumn: number; line: number; column: number }[]>): string {
  const lastLine = Math.max(-1, ...lines.keys());
  let previousSourceLine = 0;
  let previousSourceColumn = 0;
  const result: string[] = [];
  for (let generatedLine = 0; generatedLine <= lastLine; generatedLine++) {
    const sources = lines.get(generatedLine);
    if (!sources) {
      result.push("");
      continue;
    }
    let previousGeneratedColumn = 0;
    result.push([...sources]
      .sort((left, right) => left.generatedColumn - right.generatedColumn)
      .map(source => {
        const segment = [
          encodeVlq(source.generatedColumn - previousGeneratedColumn),
          encodeVlq(0),
          encodeVlq(source.line - previousSourceLine),
          encodeVlq(source.column - previousSourceColumn),
        ].join("");
        previousGeneratedColumn = source.generatedColumn;
        previousSourceLine = source.line;
        previousSourceColumn = source.column;
        return segment;
      })
      .join(","));
  }
  return result.join(";");
}

function encodeVlq(value: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let remaining = (Math.abs(value) << 1) | (value < 0 ? 1 : 0);
  let encoded = "";
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) digit |= 32;
    encoded += alphabet[digit];
  } while (remaining > 0);
  return encoded;
}

/**
 * A bare atom supplied to a user component is a transport of shared state,
 * not a render read. Preserve the reference so the receiving component can
 * subscribe, write, or pass it on. Native DOM attributes still receive a
 * snapshot through the regular JSX rewrite.
 */
function isSharedAtomComponentProp(
  expression: ts.JsxExpression,
  atoms: ReadonlySet<string>,
): boolean {
  if (!expression.expression || !isAtomReferenceExpression(expression.expression, atoms)) {
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
  return tagName !== undefined && ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text);
}

function isAtomReferenceExpression(expression: ts.Expression, atoms: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(expression)) return atoms.has(expression.text);
  return ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) && expression.expression.text === "atomRef" &&
    expression.arguments.length === 1 &&
    ts.isIdentifier(expression.arguments[0]) && atoms.has(expression.arguments[0].text);
}

const runtimePrelude = `import { useEffect as __streamixUseEffect, useRef as __streamixUseRef, useSyncExternalStore as __streamixUseSyncExternalStore } from "react";
const __streamixSubscriptions = new WeakMap<object, { listeners: Set<() => void>; stop: any; generation: number }>();
const __streamixLocalDisposals = new WeakMap<object, object>();
function __streamixLocal(factory: () => any): any {
  const ref = __streamixUseRef<any>(null);
  if (ref.current === null) ref.current = factory();
  __streamixUseEffect(() => {
    const instance = ref.current;
    const token = {};
    __streamixLocalDisposals.set(instance, token);
    return () => {
      queueMicrotask(() => {
        if (__streamixLocalDisposals.get(instance) !== token) return;
        __streamixLocalDisposals.delete(instance);
        if (typeof instance?.dispose === "function") instance.dispose();
      });
    };
  }, []);
  return ref.current;
}
function __streamixTrace(type: "read" | "subscription" | "write" | "unsubscribe" | "render", source: string): void {
  (globalThis as any).__streamixDevtoolsRecord?.({ type, source });
}
function __streamixUse(source: any, sourceName = "dynamic atom"): any {
  return __streamixUseSyncExternalStore(
    (notify: () => void) => {
      __streamixTrace("subscription", sourceName);
      let entry = __streamixSubscriptions.get(source);
      if (!entry) {
        entry = { listeners: new Set(), stop: null, generation: 0 };
        __streamixSubscriptions.set(source, entry);
      }
      entry.generation++;
      entry.listeners.add(notify);
      if (!entry.stop) {
        entry.stop = source.subscribe(() => { __streamixTrace("write", sourceName); for (const listener of entry!.listeners) listener(); });
      }
      return () => {
        entry!.listeners.delete(notify);
        if (entry!.listeners.size > 0) return;
        const generation = ++entry!.generation;
        queueMicrotask(() => {
          if (entry!.generation !== generation || entry!.listeners.size > 0) return;
          __streamixTrace("unsubscribe", sourceName);
          void entry!.stop();
          __streamixSubscriptions.delete(source);
        });
      };
    },
    () => { __streamixTrace("read", sourceName); try { return source.value; } catch { return undefined; } },
    () => { __streamixTrace("read", sourceName); try { return source.value; } catch { return undefined; } },
  );
}
`;

function collectModuleBindings(sourceFile: ts.SourceFile, factoryName: string): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      if (ts.isIdentifier(declaration.initializer.expression) && declaration.initializer.expression.text === factoryName) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function collectModuleWritableBindings(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Let) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      if (ts.isIdentifier(declaration.initializer.expression) && ["atom", "derived", "flow"].includes(declaration.initializer.expression.text)) {
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
  return kind === ts.SyntaxKind.EqualsToken || compoundOperator(ts.factory, kind) !== undefined;
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
    default: return undefined;
  }
}

function rewriteAtomReads(
  expression: ts.Expression,
  atoms: ReadonlySet<string>,
  atomMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  context: ts.TransformationContext,
): ts.Expression {
  const visitor: ts.Visitor = (node) => {
    if (ts.isIdentifier(node) && atoms.has(node.text)) {
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
  return node;
}
