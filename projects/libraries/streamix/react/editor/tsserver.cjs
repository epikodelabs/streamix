"use strict";

// tsserver loads plugins synchronously through CommonJS. Keep this adapter
// dependency-free: it receives TypeScript from tsserver itself and presents a
// virtual TSX document only to the language service. Vite/the production
// compiler remain the authority for emitted JS.
module.exports = function init(modules) {
  const ts = modules.typescript;

  // Atom writes the editor lowers to `.next(...)` in the virtual document so
  // the authored operator type-checks. Mirrors the production compiler's
  // operator table. `null` marks plain assignment.
  const WRITE_OPERATORS = new Map([
    [ts.SyntaxKind.EqualsToken, null],
    [ts.SyntaxKind.PlusEqualsToken, "+"],
    [ts.SyntaxKind.MinusEqualsToken, "-"],
    [ts.SyntaxKind.AsteriskEqualsToken, "*"],
    [ts.SyntaxKind.SlashEqualsToken, "/"],
    [ts.SyntaxKind.PercentEqualsToken, "%"],
    [ts.SyntaxKind.AmpersandEqualsToken, "&"],
    [ts.SyntaxKind.BarEqualsToken, "|"],
    [ts.SyntaxKind.CaretEqualsToken, "^"],
    [ts.SyntaxKind.AsteriskAsteriskEqualsToken, "**"],
    [ts.SyntaxKind.LessThanLessThanEqualsToken, "<<"],
    [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ">>"],
    [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ">>>"],
    [ts.SyntaxKind.AmpersandAmpersandEqualsToken, "&&"],
    [ts.SyntaxKind.BarBarEqualsToken, "||"],
    [ts.SyntaxKind.QuestionQuestionEqualsToken, "??"],
  ]);

  function isAdoptable(fileName, source) {
    if (!/\.[jt]sx?$/i.test(fileName) || /\.(?:d|spec|test)\.[jt]sx?$/i.test(fileName)) return false;
    return /\.[jt]sx$/i.test(fileName) || source.includes("@epikodelabs/streamix");
  }

  function virtualize(fileName, source) {
    const kind = /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX :
      /\.jsx$/i.test(fileName) ? ts.ScriptKind.JSX :
      /\.js$/i.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
    const factories = new Set();
    const derivedFactories = new Set();
    const flowFactories = new Set();
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !/^@epikodelabs\/streamix(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause && statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName || item.name).text === "atom") factories.add(item.name.text);
        if ((item.propertyName || item.name).text === "derived") derivedFactories.add(item.name.text);
        if ((item.propertyName || item.name).text === "flow") flowFactories.add(item.name.text);
      }
    }
    // Named imports are not proof that a call resolves to that import: an
    // inner function/block may shadow `atom` with a perfectly ordinary helper.
    // Resolve lexical declarations conservatively before virtualizing a call.
    const localBindings = (name, node) => {
      if (ts.isIdentifier(name)) return new Set([name.text]);
      if (!ts.isBindingPattern(name)) return new Set();
      const result = new Set();
      for (const entry of name.elements) {
        if (!ts.isOmittedExpression(entry)) for (const name of localBindings(entry.name)) result.add(name);
      }
      return result;
    };
    const factoryIsShadowed = callee => {
      const factoryName = callee.text;
      for (let parent = callee.parent; parent && parent !== file; parent = parent.parent) {
        if (ts.isFunctionLike(parent)) {
          if (parent.name && ts.isIdentifier(parent.name) && parent.name.text === factoryName) return true;
          if (parent.parameters.some(parameter => localBindings(parameter.name).has(factoryName))) return true;
        }
        if (ts.isCatchClause(parent) && parent.variableDeclaration && localBindings(parent.variableDeclaration.name).has(factoryName)) return true;
        if (ts.isBlock(parent)) for (const statement of parent.statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === factoryName) return true;
          if (ts.isClassDeclaration(statement) && statement.name?.text === factoryName) return true;
          if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => localBindings(declaration.name).has(factoryName))) return true;
        }
        if ((ts.isForStatement(parent) || ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
            parent.initializer && ts.isVariableDeclarationList(parent.initializer) &&
            parent.initializer.declarations.some(declaration => localBindings(declaration.name).has(factoryName))) return true;
      }
      return false;
    };
    const atoms = new Set();
    const edits = [];
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
          (factories.has(node.initializer.expression.text) || derivedFactories.has(node.initializer.expression.text) ||
           flowFactories.has(node.initializer.expression.text)) &&
          !factoryIsShadowed(node.initializer.expression)) atoms.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(file);

    // An explicit `.value` read already observes the current value; rewriting
    // its base would produce a nonsensical second `.value` in the virtual
    // document.
    const isValueRead = node => ts.isPropertyAccessExpression(node.parent) &&
      node.parent.expression === node && node.parent.name.text === "value";
    const isNamePosition = node => {
      const parent = node.parent;
      return parent && (
        ts.isPropertyAccessExpression(parent) && parent.name === node ||
        ts.isPropertyAssignment(parent) && parent.name === node ||
        ts.isShorthandPropertyAssignment(parent) && parent.name === node ||
        (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) ||
         ts.isFunctionDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node
      );
    };
    const boundNames = (binding, names) => {
      if (ts.isIdentifier(binding)) names.add(binding.text);
      else if (ts.isBindingPattern(binding)) for (const part of binding.elements)
        if (!ts.isOmittedExpression(part)) boundNames(part.name, names);
    };
    const shadowed = node => {
      for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
        if (ts.isFunctionLike(parent)) {
          const parameters = new Set();
          for (const parameter of parent.parameters) boundNames(parameter.name, parameters);
          if (parameters.has(node.text)) return true;
        }
      }
      return false;
    };
    const isRead = node => atoms.has(node.text) && !isValueRead(node) &&
      !isNamePosition(node) && !shadowed(node);
    const isComponentTransport = node => {
      if (!ts.isIdentifier(node) || !atoms.has(node.text) || !ts.isJsxExpression(node.parent) ||
          !ts.isJsxAttribute(node.parent.parent)) return false;
      const opening = node.parent.parent.parent.parent;
      if (!opening || !(ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening))) return false;
      const tag = opening.tagName;
      return ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text) ||
        ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && /^[A-Z]/.test(tag.expression.text);
    };

    // The production compiler accepts `derived(() => price * quantity)` and
    // lowers the raw atom reads to `.value`. Give TypeScript that same value
    // shape so editor diagnostics do not disagree with the build.
    const rewriteDerivedCallbacks = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          derivedFactories.has(node.expression.text) && node.arguments.length > 0 &&
          (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
        const callback = node.arguments[0];
        const visitCallback = child => {
          if (ts.isShorthandPropertyAssignment(child) && atoms.has(child.name.text) && !shadowed(child.name)) {
            edits.push({ start: child.getStart(file), end: child.end, text: `${child.name.text}: ${child.name.text}.value` });
            return;
          }
          if (ts.isIdentifier(child) && isRead(child)) {
            edits.push({ start: child.getStart(file), end: child.end, text: `${child.text}.value` });
            return;
          }
          ts.forEachChild(child, visitCallback);
        };
        visitCallback(callback.body);
      }
      ts.forEachChild(node, rewriteDerivedCallbacks);
    };

    const rewriteReads = node => {
      // The emitted compiler lowers reactive values in JSX to their current
      // value (through the runtime's concurrent-safe subscription helper). The
      // virtual file only needs the type shape, so an identifier read becomes
      // `.value`, giving TypeScript the authored value type without injecting
      // runtime behavior into the editor process.
      if (ts.isShorthandPropertyAssignment(node) && atoms.has(node.name.text) && !shadowed(node.name)) {
        edits.push({ start: node.getStart(file), end: node.end, text: `${node.name.text}: ${node.name.text}.value` });
        return;
      }
      if (ts.isIdentifier(node) && isRead(node) && !isComponentTransport(node)) {
        edits.push({ start: node.getStart(file), end: node.end, text: `${node.text}.value` });
        return;
      }
      // A write is lowered by the outer traversal, which patches reads on the
      // right side itself. Never rewrite the target as a read, and don't
      // descend into a right side that the whole-write edit will replace.
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && atoms.has(node.left.text) &&
          WRITE_OPERATORS.has(node.operatorToken.kind)) {
        return;
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          ts.isIdentifier(node.operand) && atoms.has(node.operand.text)) return;
      ts.forEachChild(node, rewriteReads);
    };

    // Reads inside a write's right-hand side must observe the value inside the
    // lowered `.next(...)` argument. Collect them into a private list so the
    // whole-write edit can apply them itself.
    const collectReadEdits = (node, out) => {
      if (ts.isShorthandPropertyAssignment(node) && atoms.has(node.name.text) && !shadowed(node.name)) {
        out.push({ start: node.getStart(file), end: node.end, text: `${node.name.text}: ${node.name.text}.value` });
        return;
      }
      if (ts.isIdentifier(node) && isRead(node)) {
        out.push({ start: node.getStart(file), end: node.end, text: `${node.text}.value` });
        return;
      }
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && atoms.has(node.left.text) &&
          WRITE_OPERATORS.has(node.operatorToken.kind)) {
        return;
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          ts.isIdentifier(node.operand) && atoms.has(node.operand.text)) return;
      ts.forEachChild(node, n => collectReadEdits(n, out));
    };

    const patchText = (text, localEdits, baseOffset) => {
      if (localEdits.length === 0) return text;
      let cursor = 0;
      let patched = "";
      for (const edit of localEdits) {
        patched += text.slice(cursor, edit.start - baseOffset);
        patched += edit.text;
        cursor = edit.end - baseOffset;
      }
      patched += text.slice(cursor);
      return patched;
    };

    const rewrite = node => {
      if (ts.isJsxExpression(node) && node.expression) rewriteReads(node.expression);
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && atoms.has(node.left.text) &&
          WRITE_OPERATORS.has(node.operatorToken.kind)) {
        const right = node.right;
        const rightStart = right.getStart(file);
        // Reads inside the right side must observe the value inside the
        // lowered `.next(...)` argument, so patch them into the replacement
        // instead of letting whole-write edit overlap drop them.
        const rightEdits = [];
        collectReadEdits(right, rightEdits);
        const rightText = patchText(source.slice(rightStart, right.end), rightEdits, rightStart);
        const atom = node.left.text;
        const kind = node.operatorToken.kind;
        const operator = WRITE_OPERATORS.get(kind);
        let text;
        if (kind === ts.SyntaxKind.EqualsToken) {
          text = `${atom}.next(${rightText})`;
        } else if (operator === "&&" || operator === "||" || operator === "??") {
          // Short-circuit operators keep their condition in the virtual
          // document so the value types match the lowered runtime semantics.
          const current = `${atom}.value`;
          const condition = operator === "&&" ? current
            : operator === "||" ? `!${current}`
            : `(${current} === null || ${current} === undefined)`;
          text = `${atom}.next(${condition} ? (${rightText}) : ${current})`;
        } else {
          text = `${atom}.next(${atom}.value ${operator} (${rightText}))`;
        }
        edits.push({ start: node.getStart(file), end: node.end, text });
        return;
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          ts.isIdentifier(node.operand) && atoms.has(node.operand.text)) {
        const name = node.operand.text;
        const delta = node.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-";
        const previous = "__streamixEditorValue";
        if (ts.isPostfixUnaryExpression(node)) {
          edits.push({ start: node.getStart(file), end: node.end,
            text: `(() => { const ${previous} = ${name}.value; ${name}.next(${previous} ${delta} 1); return ${previous}; })()` });
        } else {
          edits.push({ start: node.getStart(file), end: node.end,
            text: `(() => { const ${previous} = ${name}.value; ${name}.next(${previous} ${delta} 1); return ${name}.value; })()` });
        }
        return;
      }
      ts.forEachChild(node, rewrite);
    };
    rewriteDerivedCallbacks(file);
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
        if (!original) return original;
        const text = original.getText(0, original.getLength());
        if (!isAdoptable(fileName, text)) return original;
        const document = virtualize(fileName, text);
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
      const mapDiagnostics = (fileName, diagnostics) => diagnostics.map(diagnostic => ({
        ...diagnostic,
        ...(!documentFor(fileName) || diagnostic.start === undefined ? {} : {
          start: documentFor(fileName).toOriginal(diagnostic.start),
          length: diagnostic.length === undefined ? diagnostic.length :
            Math.max(0, documentFor(fileName).toOriginal(diagnostic.start + diagnostic.length) -
              documentFor(fileName).toOriginal(diagnostic.start)),
        }),
      }));
      for (const kind of ["getSemanticDiagnostics", "getSyntacticDiagnostics", "getSuggestionDiagnostics"]) {
        if (typeof service[kind] === "function")
          proxy[kind] = fileName => mapDiagnostics(fileName, service[kind](fileName));
      }
      proxy.getCompletionsAtPosition = (fileName, position, options, formattingSettings) => {
        const document = documentFor(fileName);
        const result = service.getCompletionsAtPosition(fileName, document ? document.toGenerated(position) : position, options, formattingSettings);
        if (!result) return result;
        return {
          ...result,
          optionalReplacementSpan: mapSpan(fileName, result.optionalReplacementSpan),
          entries: result.entries.map(entry => ({ ...entry, replacementSpan: mapSpan(fileName, entry.replacementSpan) })),
        };
      };
      if (typeof service.getCompletionEntryDetails === "function")
        proxy.getCompletionEntryDetails = (fileName, position, ...args) => {
          const document = documentFor(fileName);
          return service.getCompletionEntryDetails(fileName, document ? document.toGenerated(position) : position, ...args);
        };
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
