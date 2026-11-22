import ts from 'typescript';

function symbolAt(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  const symbol = node.parent && ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function metadata(
  declaration: ts.ClassDeclaration,
  name: 'Component' | 'NgModule',
  checker: ts.TypeChecker,
): ts.ObjectLiteralExpression | undefined {
  for (const decorator of ts.getDecorators(declaration) ?? []) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) continue;
    const { expression: factory } = expression;
    const identifier = ts.isPropertyAccessExpression(factory) ? factory.name : factory;
    if (!ts.isIdentifier(identifier)) continue;
    const argument = expression.arguments[0];
    if ((symbolAt(checker, identifier)?.name === name || identifier.text === name) &&
        argument && ts.isObjectLiteralExpression(argument)) return argument;
  }
  return undefined;
}

function property(metadata: ts.ObjectLiteralExpression | undefined, name: string): ts.Expression | undefined {
  const entry = metadata?.properties.find((member): member is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
    (ts.isPropertyAssignment(member) || ts.isShorthandPropertyAssignment(member)) &&
    (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
    member.name.text === name);
  return entry && (ts.isShorthandPropertyAssignment(entry) ? entry.name : entry.initializer);
}

/** Visits class references in Angular's static arrays and declaration tuples. */
function visitReferences(
  node: ts.Node | undefined,
  checker: ts.TypeChecker,
  visitClass: (declaration: ts.ClassDeclaration) => void,
  seen = new Set<ts.Node>(),
): void {
  if (!node || seen.has(node)) return;
  seen.add(node);
  if (ts.isArrayLiteralExpression(node) || ts.isTupleTypeNode(node)) {
    for (const element of node.elements) visitReferences(element, checker, visitClass, seen);
  } else if (ts.isSpreadElement(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
    visitReferences(node.expression, checker, visitClass, seen);
  } else if (ts.isTypeOperatorNode(node)) {
    visitReferences(node.type, checker, visitClass, seen);
  } else if (ts.isCallExpression(node)) {
    const factory = node.expression;
    // ModuleWithProviders calls use the receiver. forwardRef() uses a factory.
    const name = ts.isPropertyAccessExpression(factory) ? factory.name : factory;
    if (ts.isIdentifier(name) && (symbolAt(checker, name)?.name ?? name.text) === 'forwardRef') {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const body = callback.body;
        visitReferences(ts.isBlock(body)
          ? body.statements.find(ts.isReturnStatement)?.expression : body, checker, visitClass, seen);
      }
    } else if (ts.isPropertyAccessExpression(factory)) {
      visitReferences(factory.expression, checker, visitClass, seen);
    }
  } else {
    const reference = ts.isTypeQueryNode(node) ? node.exprName
      : ts.isPropertyAccessExpression(node) ? node.name : node;
    for (const declaration of symbolAt(checker, reference)?.declarations ?? []) {
      if (ts.isClassDeclaration(declaration)) visitClass(declaration);
      else if (ts.isVariableDeclaration(declaration)) {
        visitReferences(declaration.initializer ?? declaration.type, checker, visitClass, seen);
      }
    }
  }
}

function declarationMetadata(declaration: ts.ClassDeclaration, name: string): ts.TypeReferenceNode | undefined {
  for (const member of declaration.members) {
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) &&
        member.name.text === name && member.type && ts.isTypeReferenceNode(member.type)) return member.type;
  }
  return undefined;
}

/** Finds component selectors visible through standalone imports or an NgModule. */
export function componentSelectorsInScope(
  component: ts.ClassDeclaration,
  program: ts.Program,
  checker: ts.TypeChecker,
): string[] {
  const selectors = new Set<string>();
  const visited = new Set<ts.ClassDeclaration>();
  const addVisible = (declaration: ts.ClassDeclaration): void => {
    if (visited.has(declaration)) return;
    visited.add(declaration);
    const selector = property(metadata(declaration, 'Component', checker), 'selector');
    const selectorType = declarationMetadata(declaration, 'ɵcmp')?.typeArguments?.[1];
    if (selector && ts.isStringLiteralLike(selector)) {
      selectors.add(selector.text);
    } else if (selector) {
      const type = checker.getTypeAtLocation(selector);
      if (type.isStringLiteral()) selectors.add(type.value);
    } else if (selectorType && ts.isLiteralTypeNode(selectorType) && ts.isStringLiteral(selectorType.literal)) {
      selectors.add(selectorType.literal.text);
    }
    const exports = property(metadata(declaration, 'NgModule', checker), 'exports') ??
      declarationMetadata(declaration, 'ɵmod')?.typeArguments?.[3];
    visitReferences(exports, checker, addVisible);
  };

  const options = metadata(component, 'Component', checker);
  if (property(options, 'standalone')?.kind !== ts.SyntaxKind.FalseKeyword) {
    visitReferences(property(options, 'imports'), checker, addVisible);
  } else {
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile || !source.text.includes('NgModule')) continue;
      for (const statement of source.statements) {
        if (!ts.isClassDeclaration(statement)) continue;
        const options = metadata(statement, 'NgModule', checker);
        const declarations = property(options, 'declarations');
        const members = new Set<ts.ClassDeclaration>();
        visitReferences(declarations, checker, member => { members.add(member); });
        if (!members.has(component)) continue;
        for (const member of members) addVisible(member);
        visitReferences(property(options, 'imports'), checker, addVisible);
      }
    }
  }
  return [...selectors];
}
