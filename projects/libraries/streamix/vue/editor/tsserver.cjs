"use strict";

// Vue Language Tools loads plugins from `vueCompilerOptions.plugins`. This
// plugin is deliberately small: the production Streamix compiler remains the
// authority for emitted SFC code, while the editor sees the same value shape
// for raw atom reads inside a derived callback.
module.exports = function streamixVueLanguagePlugin(ctx) {
  const ts = ctx.modules.typescript;

  function transformedScript(lang, source) {
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
    const isValueRead = node => {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === "value") return false;
      if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
      if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
      if (ts.isParameter(parent) && parent.name === node) return false;
      if (ts.isTypeReferenceNode(parent)) return false;
      return true;
    };
    const hasBinding = (binding, name) => ts.isIdentifier(binding)
      ? binding.text === name
      : binding.elements.some(element => ts.isBindingElement(element) && hasBinding(element.name, name));
    const shadowed = (node, body, name) => {
      for (let scope = node.parent; scope; scope = scope.parent) {
        if (ts.isFunctionLike(scope) && scope.parameters.some(param => hasBinding(param.name, name))) return true;
        if (ts.isBlock(scope) && scope.statements.some(statement =>
          ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl => hasBinding(decl.name, name)) ||
          ts.isFunctionDeclaration(statement) && statement.name?.text === name)) return true;
        if (scope === body) break;
      }
      return false;
    };
    const rewriteCallback = (callback, node = callback.body) => {
      if (ts.isIdentifier(node) && atoms.has(node.text) &&
          isValueRead(node) && !shadowed(node, callback, node.text)) {
        const shorthand = ts.isShorthandPropertyAssignment(node.parent);
        edits.push({ start: node.getStart(file), end: node.end,
          text: shorthand ? `${node.text}: ${node.text}.value` : `${node.text}.value` });
        return;
      }
      ts.forEachChild(node, child => rewriteCallback(callback, child));
    };
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          derivedFactories.has(node.expression.text) && node.arguments.length > 0 &&
          (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
        rewriteCallback(node.arguments[0]);
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
    // API version 2.1 is supported by Vue Language Tools 2.2+ and newer.
    version: 2.1,
    name: "streamix-vue",
    compileSFCScript: transformedScript,
  };
};
