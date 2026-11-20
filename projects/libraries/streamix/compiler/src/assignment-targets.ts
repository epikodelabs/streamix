import ts from 'typescript';

/** Finds a matching assignment target without traversing keys or default values. */
export function findAssignmentTarget(
  target: ts.Expression,
  matches: (target: ts.Expression) => boolean,
  unwrap: (target: ts.Expression) => ts.Expression,
): ts.Expression | undefined {
  const expression = unwrap(target);
  const find = (child: ts.Expression) => findAssignmentTarget(child, matches, unwrap);
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      const found = ts.isShorthandPropertyAssignment(property) ? find(property.name)
        : ts.isPropertyAssignment(property) ? find(property.initializer)
        : ts.isSpreadAssignment(property) ? find(property.expression) : undefined;
      if (found) return found;
    }
    return undefined;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      const found = find(ts.isSpreadElement(element) ? element.expression : element);
      if (found) return found;
    }
    return undefined;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return find(expression.left);
  }
  return matches(expression) ? expression : undefined;
}
