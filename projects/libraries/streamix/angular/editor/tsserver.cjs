"use strict";

// Streamix owns the Angular LS plugin so it can virtualize component source
// before Angular creates its template type-checking program.
module.exports = function init(modules) {
  const ts = modules.typescript;
  const angularPlugin = require("@angular/language-service")(modules);

  function virtualize(fileName, source) {
    if (!/\.tsx?$/i.test(fileName)) return undefined;
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const factories = new Set();
    const derivedFactories = new Set();
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause && statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName || item.name).text === "atom") factories.add(item.name.text);
        if ((item.propertyName || item.name).text === "derived") derivedFactories.add(item.name.text);
      }
    }
    const edits = [];
    for (const declaration of file.statements) {
      if (!ts.isClassDeclaration(declaration)) continue;
      const atoms = new Set();
      for (const member of declaration.members) {
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.initializer &&
            ts.isCallExpression(member.initializer) && ts.isIdentifier(member.initializer.expression) &&
            factories.has(member.initializer.expression.text)) atoms.add(member.name.text);
      }
      if (atoms.size === 0) continue;
      const rewriteDerivedCallbacks = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
            derivedFactories.has(node.expression.text) && node.arguments.length > 0 &&
            (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
          const callback = node.arguments[0];
          const visitCallback = child => {
            if (ts.isPropertyAccessExpression(child) && child.expression.kind === ts.SyntaxKind.ThisKeyword &&
                atoms.has(child.name.text)) {
              edits.push({ start: child.getStart(file), end: child.end, text: child.getText(file) + ".value" });
              return;
            }
            if (ts.isIdentifier(child) && atoms.has(child.text) &&
                !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) &&
                !(ts.isPropertyAccessExpression(child.parent) && child.parent.expression === child && child.parent.name.text === "value")) {
              edits.push({ start: child.getStart(file), end: child.end, text: child.text + ".value" });
              return;
            }
            ts.forEachChild(child, visitCallback);
          };
          visitCallback(callback.body);
        }
        ts.forEachChild(node, rewriteDerivedCallbacks);
      };
      rewriteDerivedCallbacks(declaration);
      for (const decorator of ts.getDecorators(declaration) || []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "Component") continue;
        const metadata = call.arguments[0];
        if (!metadata || !ts.isObjectLiteralExpression(metadata)) continue;
        for (const property of metadata.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) ||
              property.name.text !== "template" || !ts.isNoSubstitutionTemplateLiteral(property.initializer)) continue;
          const template = property.initializer;
          const text = rewriteTemplate(template.text, atoms);
          if (text !== template.text) edits.push({ start: template.getStart(file) + 1, end: template.getStart(file) + 1 + template.text.length, text });
        }
      }
    }
    if (edits.length === 0) return { code: source, toOriginal: position => position, toGenerated: position => position };
    edits.sort((a, b) => a.start - b.start);
    let cursor = 0;
    let code = "";
    const mappings = [];
    for (const edit of edits) {
      code += source.slice(cursor, edit.start);
      const generatedStart = code.length;
      code += edit.text;
      mappings.push({ originalStart: edit.start, originalEnd: edit.end, generatedStart, generatedEnd: code.length });
      cursor = edit.end;
    }
    code += source.slice(cursor);
    return {
      code,
      toOriginal: position => mapPosition(position, mappings, "generated", "original"),
      toGenerated: position => mapPosition(position, mappings, "original", "generated"),
    };
  }

  function mapPosition(position, mappings, from, to) {
    let delta = 0;
    const start = from + "Start";
    const end = from + "End";
    const targetStart = to + "Start";
    const targetEnd = to + "End";
    for (const mapping of mappings) {
      if (position < mapping[start]) return Math.max(0, position + delta);
      if (position <= mapping[end]) return mapping[targetStart];
      delta += (mapping[targetEnd] - mapping[targetStart]) - (mapping[end] - mapping[start]);
    }
    return Math.max(0, position + delta);
  }

  function rewriteTemplate(template, atoms) {
    return template
      // Block headers and @let values are compiled positions too: the build
      // lowers atom reads there, so the editor must see the same value shapes
      // or every block condition would surface a false type error.
      .replace(/(@(?:else\s+)?if|@switch|@for)\s*\(([\s\S]*?)\)\s*\{/g,
        (_, header, expression) => header + " (" + rewriteExpression(expression, atoms) + ") {")
      .replace(/(@let\s+[\w$]+\s*=\s*)([^;]+);/g,
        (_, prefix, expression) => prefix + rewriteExpression(expression, atoms) + ";")
      .replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => "{{" + rewriteExpression(expression, atoms) + "}}")
      .replace(/((?:\[\([\w.-]+\)\]|\[[\w.-]+\]|\([\w.-]+\))\s*=\s*)(["'])([\s\S]*?)\2/g, (_, prefix, quote, expression) =>
        prefix + quote + rewriteExpression(expression, atoms) + quote);
  }

  function rewriteExpression(expression, atoms) {
    let result = expression;
    for (const atom of atoms) {
      const escaped = atom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp("\\b" + escaped + "\\s*\\+=\\s*([^;]+)$"), (_, value) =>
        atom + ".next(" + atom + ".value + (" + value + "))");
      result = result.replace(new RegExp("\\b" + escaped + "\\s*=\\s*([^=][^;]*)$"), (_, value) =>
        atom + ".next(" + value + ")");
      result = result.replace(new RegExp("\\b" + escaped + "\\b(?!\\s*\\.)", "g"), atom + ".value");
    }
    return result;
  }

  return {
    create(info) {
      const host = info.languageServiceHost;
      const snapshot = host.getScriptSnapshot.bind(host);
      const version = host.getScriptVersion && host.getScriptVersion.bind(host);
      const documents = new Map();
      host.getScriptSnapshot = fileName => {
        const original = snapshot(fileName);
        if (!original) return original;
        const document = virtualize(fileName, original.getText(0, original.getLength()));
        if (!document) return original;
        documents.set(fileName, document);
        return ts.ScriptSnapshot.fromString(document.code);
      };
      if (version) host.getScriptVersion = fileName => version(fileName) + ":streamix-angular-editor";
      const service = angularPlugin.create(info);
      const proxy = Object.create(null);
      for (const key of Object.keys(service)) proxy[key] = (...args) => service[key](...args);
      const documentFor = fileName => documents.get(fileName);
      proxy.getSemanticDiagnostics = fileName => service.getSemanticDiagnostics(fileName).map(diagnostic => {
        const document = documentFor(fileName);
        if (!document || diagnostic.start === undefined) return diagnostic;
        return {
          ...diagnostic,
          start: document.toOriginal(diagnostic.start),
          length: diagnostic.length === undefined ? undefined :
            Math.max(0, document.toOriginal(diagnostic.start + diagnostic.length) - document.toOriginal(diagnostic.start)),
        };
      });
      return proxy;
    },
    getExternalFiles: angularPlugin.getExternalFiles,
    // Kept internal; exercised to ensure the virtual document used by the
    // Angular LS has the same atom-value semantics as the build transform.
    __streamixVirtualize: virtualize,
  };
};
