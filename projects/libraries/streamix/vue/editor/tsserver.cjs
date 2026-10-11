"use strict";

// Vue Language Tools loads plugins from `vueCompilerOptions.plugins`. This
// plugin is deliberately small: the production Streamix compiler remains the
// authority for emitted SFC code, while the editor sees the same value shape
// for raw atom reads inside a derived callback.
module.exports = function streamixVueLanguagePlugin(ctx) {
  const ts = ctx.modules.typescript;

  function transformedScript(source, lang) {
    if (!/^(?:ts|tsx|js|jsx)$/i.test(lang || "ts")) return undefined;
    const kind = /tsx|jsx/i.test(lang || "") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile("streamix.vue.ts", source, ts.ScriptTarget.Latest, true, kind);
    const atomFactories = new Set();
    const derivedFactories = new Set();

    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause && statement.importClause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const item of bindings.elements) {
        const imported = (item.propertyName || item.name).text;
        if (imported === "atom") atomFactories.add(item.name.text);
        if (imported === "derived") derivedFactories.add(item.name.text);
      }
    }

    const atoms = new Set();
    const findAtoms = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
          atomFactories.has(node.initializer.expression.text)) atoms.add(node.name.text);
      ts.forEachChild(node, findAtoms);
    };
    findAtoms(file);
    if (atoms.size === 0 || derivedFactories.size === 0) return undefined;

    const edits = [];
    const isExplicitValue = node => ts.isPropertyAccessExpression(node.parent) &&
      node.parent.expression === node && node.parent.name.text === "value";
    const rewriteCallback = node => {
      if (ts.isIdentifier(node) && atoms.has(node.text) && !isExplicitValue(node) &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        edits.push({ start: node.getStart(file), end: node.end, text: `${node.text}.value` });
        return;
      }
      ts.forEachChild(node, rewriteCallback);
    };
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          derivedFactories.has(node.expression.text) && node.arguments.length > 0 &&
          (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
        rewriteCallback(node.arguments[0].body);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (edits.length === 0) return undefined;

    edits.sort((left, right) => right.start - left.start);
    let code = source;
    for (const edit of edits) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
    return ts.createSourceFile("streamix.vue.ts", code, ts.ScriptTarget.Latest, true, kind);
  }

  return {
    version: 2.2,
    name: "streamix-vue",
    compileSFCScript: transformedScript,
  };
};
