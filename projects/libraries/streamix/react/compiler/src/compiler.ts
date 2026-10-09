import ts from 'typescript';

export interface ReactJsxTransformResult {
  /** Transformed TypeScript/TSX source. */
  readonly code: string;
  /** Number of reactive JSX bindings introduced by the transform. */
  readonly bindingCount: number;
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
  const moduleAtoms = new Set([
    ...collectModuleBindings(sourceFile, "atom"),
    ...collectModuleBindings(sourceFile, "derived"),
    ...collectModuleBindings(sourceFile, "flow"),
  ]);
  const moduleScopes = collectModuleBindings(sourceFile, "scope");

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const factory = context.factory;

    const transformFunction = <T extends ts.FunctionLikeDeclarationBase>(node: T): T => {
      if (!node.body || !ts.isBlock(node.body)) return node;

      const atoms = new Set<string>(moduleAtoms);
      const scopes = new Set<string>(moduleScopes);
      let insertionIndex = 0;

      node.body.statements.forEach((statement, index) => {
        if (!ts.isVariableStatement(statement)) return;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
            continue;
          }
          if (ts.isIdentifier(declaration.initializer.expression)) {
            if (["atom", "derived", "flow"].includes(declaration.initializer.expression.text)) atoms.add(declaration.name.text);
            if (declaration.initializer.expression.text === "scope") scopes.add(declaration.name.text);
          }
        }
        if (atoms.size > 0 || scopes.size > 0) insertionIndex = index + 1;
      });

      if (atoms.size === 0 && scopes.size === 0) return node;

      const bindings: ts.VariableStatement[] = [];
      const atomBindings = new Map<string, ts.Identifier>();
      const scopeBindings = new Map<string, ts.Identifier>();
      const bindingForAtom = (atomName: string): ts.Identifier => {
        const existing = atomBindings.get(atomName);
        if (existing) return existing;
        const name = factory.createIdentifier(`__streamixBinding${bindingCount++}`);
        atomBindings.set(atomName, name);
        needsRuntimeImport = true;
        bindings.push(factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
              name,
              undefined,
              undefined,
              factory.createAsExpression(
              factory.createCallExpression(factory.createIdentifier("__streamixUse"), undefined, [
                  factory.createIdentifier(atomName),
                ]),
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
              ),
            ),
          ], ts.NodeFlags.Const),
        ));
        return name;
      };
      const bindingForScope = (scopeName: string, property: string): ts.Identifier => {
        const bindingKey = `${scopeName}.${property}`;
        const existing = scopeBindings.get(bindingKey);
        if (existing) return existing;
        const name = factory.createIdentifier(`__streamixBinding${bindingCount++}`);
        scopeBindings.set(bindingKey, name);
        needsRuntimeImport = true;
        bindings.push(factory.createVariableStatement(
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
                ]),
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
              ),
            ),
          ], ts.NodeFlags.Const),
        ));
        return name;
      };
      const rewriteJsxValue = (expression: ts.Expression): ts.Expression => {
        const jsxValueVisitor: ts.Visitor = (value) => {
          if (ts.isIdentifier(value) && atoms.has(value.text)) {
            return bindingForAtom(value.text);
          }
          if (
            ts.isPropertyAccessExpression(value) &&
            ts.isIdentifier(value.expression) &&
            scopes.has(value.expression.text)
          ) {
            return bindingForScope(value.expression.text, value.name.text);
          }
          return ts.visitEachChild(value, jsxValueVisitor, context);
        };
        return ts.visitNode(expression, jsxValueVisitor) as ts.Expression;
      };

      const visit: ts.Visitor = (child) => {
        if (
          ts.isBinaryExpression(child) &&
          child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(child.left) &&
          atoms.has(child.left.text)
        ) {
          return factory.createCallExpression(
            factory.createPropertyAccessExpression(child.left, "next"),
            undefined,
            [rewriteAtomReads(child.right, atoms, context)],
          );
        }

        if (ts.isJsxExpression(child) && child.expression) {
          if (ts.isArrowFunction(child.expression) || ts.isFunctionExpression(child.expression)) {
            return ts.visitEachChild(child, visit, context);
          }
          return factory.updateJsxExpression(child, rewriteJsxValue(child.expression));
        }

        return ts.visitEachChild(child, visit, context);
      };

      const body = ts.visitEachChild(node.body, visit, context) as ts.Block;
      if (bindings.length === 0) {
        return node;
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
  const code = printer.printFile(transformed);
  return { code: needsRuntimeImport ? `${runtimePrelude}\n${code}` : code, bindingCount };
}

const runtimePrelude = `import { useSyncExternalStore as __streamixUseSyncExternalStore } from "react";
const __streamixSubscriptions = new WeakMap<object, { listeners: Set<() => void>; stop: any; generation: number }>();
function __streamixUse(source: any): any {
  return __streamixUseSyncExternalStore(
    (notify: () => void) => {
      let entry = __streamixSubscriptions.get(source);
      if (!entry) {
        entry = { listeners: new Set(), stop: null, generation: 0 };
        __streamixSubscriptions.set(source, entry);
      }
      entry.generation++;
      entry.listeners.add(notify);
      if (!entry.stop) {
        entry.stop = source.subscribe(() => { for (const listener of entry!.listeners) listener(); });
      }
      return () => {
        entry!.listeners.delete(notify);
        if (entry!.listeners.size > 0) return;
        const generation = ++entry!.generation;
        queueMicrotask(() => {
          if (entry!.generation !== generation || entry!.listeners.size > 0) return;
          void entry!.stop();
          __streamixSubscriptions.delete(source);
        });
      };
    },
    () => { try { return source.value; } catch { return undefined; } },
    () => { try { return source.value; } catch { return undefined; } },
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

function rewriteAtomReads(
  expression: ts.Expression,
  atoms: ReadonlySet<string>,
  context: ts.TransformationContext,
): ts.Expression {
  const visitor: ts.Visitor = (node) => {
    if (ts.isIdentifier(node) && atoms.has(node.text)) {
      return context.factory.createPropertyAccessExpression(node, "value");
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
