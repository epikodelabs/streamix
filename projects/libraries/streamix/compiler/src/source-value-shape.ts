import ts from 'typescript';

/** Statically named members of an authored object value. */
export function objectValueMembers(expression: ts.Expression | undefined): ReadonlySet<string> | undefined {
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression))) {
    expression = expression.expression;
  }
  if (!expression || !ts.isObjectLiteralExpression(expression)) return undefined;
  const names = new Set<string>();
  for (const property of expression.properties) {
    const name = property.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) names.add(name.text);
  }
  return names;
}
