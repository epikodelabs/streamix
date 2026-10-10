"use strict";

// tsserver loads plugins synchronously through CommonJS. Keep this adapter
// dependency-free: it receives TypeScript from tsserver itself and presents a
// virtual TSX document only to the language service. Vite/the production
// compiler remain the authority for emitted JS.
module.exports = function init(modules) {
  const ts = modules.typescript;

  function isTsx(fileName) { return /\.tsx$/i.test(fileName); }

  function virtualize(fileName, source) {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const factories = new Set();
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause && statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName || item.name).text === "atom") factories.add(item.name.text);
      }
    }
    const atoms = new Set();
    const edits = [];
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
          factories.has(node.initializer.expression.text)) atoms.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
    const rewriteReads = node => {
      // The emitted compiler lowers reactive values in JSX to `.value` (via
      // its React subscription helper).  The virtual file only needs the type
      // shape, so preserving `.value` gives TypeScript the authored value type
      // without injecting runtime behavior into the editor process.
      if (ts.isIdentifier(node) && atoms.has(node.text)) {
        edits.push({ start: node.getStart(file), end: node.end, text: `${node.text}.value` });
        return;
      }
      // A write is handled by the outer traversal.  Never rewrite its target
      // as a read, including inside JSX callback expressions.
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && atoms.has(node.left.text) &&
          (node.operatorToken.kind === ts.SyntaxKind.EqualsToken || node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
        rewriteReads(node.right);
        return;
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          ts.isIdentifier(node.operand) && atoms.has(node.operand.text)) return;
      ts.forEachChild(node, rewriteReads);
    };
    const rewrite = node => {
      if (ts.isJsxExpression(node) && node.expression) rewriteReads(node.expression);
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && atoms.has(node.left.text)) {
        const right = source.slice(node.right.getStart(file), node.right.end);
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          edits.push({ start: node.getStart(file), end: node.end, text: `${node.left.text}.next(${right})` });
        } else if (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
          edits.push({ start: node.getStart(file), end: node.end, text: `${node.left.text}.next(${node.left.text}.value + (${right}))` });
        }
      }
      ts.forEachChild(node, rewrite);
    };
    rewrite(file);
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const nonOverlapping = edits.filter((edit, index) => index === 0 || edit.start >= edits[index - 1].end);
    let cursor = 0;
    let code = "";
    const prefix = code.length;
    const mappings = [];
    for (const edit of nonOverlapping) {
      code += source.slice(cursor, edit.start);
      const generatedStart = code.length;
      code += edit.text;
      mappings.push({ originalStart: edit.start, originalEnd: edit.end, generatedStart, generatedEnd: code.length });
      cursor = edit.end;
    }
    code += source.slice(cursor);
    const toOriginal = position => {
      let delta = prefix;
      for (const mapping of mappings) {
        if (position < mapping.generatedStart) return Math.max(0, position - delta);
        if (position <= mapping.generatedEnd) return mapping.originalStart;
        delta += (mapping.generatedEnd - mapping.generatedStart) - (mapping.originalEnd - mapping.originalStart);
      }
      return Math.max(0, position - delta);
    };
    const toGenerated = position => {
      let delta = prefix;
      for (const mapping of mappings) {
        if (position < mapping.originalStart) return position + delta;
        if (position <= mapping.originalEnd) return mapping.generatedStart;
        delta += (mapping.generatedEnd - mapping.generatedStart) - (mapping.originalEnd - mapping.originalStart);
      }
      return position + delta;
    };
    return { code, toOriginal, toGenerated };
  }

  return {
    create(info) {
      const host = info.languageServiceHost;
      const snapshot = host.getScriptSnapshot.bind(host);
      const version = host.getScriptVersion && host.getScriptVersion.bind(host);
      const documents = new Map();
      host.getScriptSnapshot = fileName => {
        const original = snapshot(fileName);
        if (!original || !isTsx(fileName)) return original;
        const document = virtualize(fileName, original.getText(0, original.getLength()));
        documents.set(fileName, document);
        return ts.ScriptSnapshot.fromString(document.code);
      };
      if (version) host.getScriptVersion = fileName => `${version(fileName)}:streamix-editor`;

      const service = info.languageService;
      const proxy = Object.create(null);
      for (const key of Object.keys(service)) proxy[key] = (...args) => service[key](...args);
      const documentFor = fileName => documents.get(fileName);
      const mapSpan = (fileName, span) => {
        const document = documentFor(fileName);
        return !document || !span ? span : { start: document.toOriginal(span.start), length: Math.max(0, document.toOriginal(span.start + span.length) - document.toOriginal(span.start)) };
      };
      proxy.getSemanticDiagnostics = fileName => service.getSemanticDiagnostics(fileName).map(diagnostic => ({ ...diagnostic, start: diagnostic.start === undefined ? undefined : documentFor(fileName).toOriginal(diagnostic.start), length: diagnostic.start === undefined || diagnostic.length === undefined ? diagnostic.length : Math.max(0, documentFor(fileName).toOriginal(diagnostic.start + diagnostic.length) - documentFor(fileName).toOriginal(diagnostic.start)) }));
      proxy.getQuickInfoAtPosition = (fileName, position) => {
        const document = documentFor(fileName);
        const infoAtPosition = service.getQuickInfoAtPosition(fileName, document ? document.toGenerated(position) : position);
        return infoAtPosition && { ...infoAtPosition, textSpan: mapSpan(fileName, infoAtPosition.textSpan) };
      };
      proxy.getDefinitionAtPosition = (fileName, position) => {
        const document = documentFor(fileName);
        return service.getDefinitionAtPosition(fileName, document ? document.toGenerated(position) : position)?.map(definition => ({ ...definition, textSpan: mapSpan(definition.fileName, definition.textSpan) }));
      };
      proxy.getReferencesAtPosition = (fileName, position) => {
        const document = documentFor(fileName);
        return service.getReferencesAtPosition(fileName, document ? document.toGenerated(position) : position)?.map(reference => ({ ...reference, textSpan: mapSpan(reference.fileName, reference.textSpan) }));
      };
      return proxy;
    },
  };
};
