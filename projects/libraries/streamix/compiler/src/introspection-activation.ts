import ts from 'typescript';

/**
 * Inject a first-import side effect, not an enable() statement in the entry
 * body: ES module dependencies evaluate before the entry's body executes.
 * The activation subentry enables diagnostics before application imports run.
 */
const inspector = '@epikodelabs/streamix/introspection';
const activation = `${inspector}/activate`;

/** First statement after the shebang, leading comments, and directive prologue. */
export function firstStatementAfterPrologue(file: ts.SourceFile): ts.Statement | undefined {
  return file.statements.find(statement =>
    !ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression));
}

export function injectIntrospectionActivation(code: string, fileName = 'entry.tsx'): string {
  const file = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest);
  const first = firstStatementAfterPrologue(file);
  const head = first?.getStart(file) ?? code.length;
  const activations: ts.ImportDeclaration[] = [];
  const mounts = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text === activation && !statement.importClause) activations.push(statement);
    const bindings = statement.importClause?.namedBindings;
    if (statement.moduleSpecifier.text !== inspector || statement.importClause?.isTypeOnly ||
        !bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if (!item.isTypeOnly && (item.propertyName ?? item.name).text === 'mountStreamixInspector') {
        mounts.add(item.name.text);
      }
    }
  }
  const hasMountCall = file.statements.some(statement =>
    ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) && mounts.has(statement.expression.expression.text));
  if (activations.length === 1 && activations[0] === first && hasMountCall) return code;

  let body = code.slice(head);
  for (const statement of activations.reverse()) {
    body = body.slice(0, statement.getStart(file) - head) + body.slice(statement.end - head);
  }
  let imports = `import '${activation}';\n`;
  let mount = mounts.values().next().value;
  if (!hasMountCall && mount === undefined) {
    const identifiers = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
    mount = '__sxMount';
    while (identifiers.has(mount)) mount += '_';
    imports += `import { mountStreamixInspector as ${mount} } from '${inspector}';\n`;
  }
  const prefix = code.slice(0, head);
  const separator = prefix && prefix !== '\uFEFF' && !/[\r\n\u2028\u2029]$/.test(prefix) ? '\n' : '';
  return `${prefix}${separator}${imports}${body}${hasMountCall ? '' : `\n${mount}();\n`}`;
}
