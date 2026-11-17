import ts from 'typescript';

const hoistedVars = new WeakMap<ts.Node, readonly ts.VariableDeclaration[]>();

/** @internal Variables bound to this function/module, excluding nested scopes. */
export function hoistedVarDeclarations(scope: ts.Node): readonly ts.VariableDeclaration[] {
  const cached = hoistedVars.get(scope);
  if (cached) return cached;
  const body = ts.isSourceFile(scope) ? scope : ts.isFunctionLike(scope)
    ? (scope as ts.FunctionLikeDeclaration).body : undefined;
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    // Functions, class static blocks and namespaces own their var bindings.
    if (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isModuleDeclaration(node)) return;
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0)
      declarations.push(...node.declarations);
    ts.forEachChild(node, visit);
  };
  if (body) visit(body);
  hoistedVars.set(scope, declarations);
  return declarations;
}
