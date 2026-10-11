"use strict";

// Streamix owns the Angular LS plugin so it can virtualize component source
// before Angular creates its template type-checking program.
module.exports = function init(modules) {
  const ts = modules.typescript;
  const angularPlugin = require("@angular/language-service")(modules);

  /** Resolve factory identity from its lexical declaration, not its spelling.
   * An imported `atom` shadowed inside an enclosing function is not a Streamix
   * factory even when a matching import exists elsewhere in the module.
   */
  function isFactoryCall(callee, names, file, program) {
    if (!ts.isIdentifier(callee) || !names.has(callee.text)) return false;
    const hasName = name => ts.isIdentifier(name) && name.text === callee.text;
    let owner = callee.parent;
    while (owner && owner !== file) {
      if (ts.isFunctionLike(owner) && owner.parameters.some(p => hasName(p.name))) return false;
      if (ts.isCatchClause(owner) && owner.variableDeclaration && hasName(owner.variableDeclaration.name)) return false;
      if (ts.isBlock(owner)) {
        for (const stmt of owner.statements) {
          if (ts.isFunctionDeclaration(stmt) && stmt.name && hasName(stmt.name)) return false;
          if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.some(d => hasName(d.name))) return false;
        }
      }
      owner = owner.parent;
    }
    // A live TypeScript program gives authoritative symbol resolution (including
    // a nested declaration or a re-bound imported alias). Only use its AST when
    // the text exactly matches the current editor snapshot.
    const semanticFile = program?.getSourceFile(file.fileName);
    if (!semanticFile || semanticFile.text !== file.text) return true;
    let semanticCallee;
    const find = node => {
      if (semanticCallee || node.pos > callee.pos || node.end < callee.end) return;
      if (ts.isIdentifier(node) && node.getStart(semanticFile) === callee.getStart(file)) {
        semanticCallee = node;
        return;
      }
      ts.forEachChild(node, find);
    };
    find(semanticFile);
    if (!semanticCallee) return true;
    const symbol = program.getTypeChecker().getSymbolAtLocation(semanticCallee);
    if (!symbol) return true;
    return (symbol.declarations || []).some(decl => {
      if (!ts.isImportSpecifier(decl)) return false;
      let parent = decl.parent;
      while (parent && !ts.isImportDeclaration(parent)) parent = parent.parent;
      return parent && ts.isStringLiteral(parent.moduleSpecifier) &&
        /^@epikodelabs\/streamix(?:\/|$)/.test(parent.moduleSpecifier.text);
    });
  }

  function virtualize(fileName, source, program) {
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
    const visitClass = declaration => {
      if (!ts.isClassDeclaration(declaration)) {
        ts.forEachChild(declaration, visitClass);
        return;
      }
      const atoms = new Set();
      for (const member of declaration.members) {
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.initializer &&
            ts.isCallExpression(member.initializer) && ts.isIdentifier(member.initializer.expression) &&
            isFactoryCall(member.initializer.expression, factories, file, program)) atoms.add(member.name.text);
      }
      if (atoms.size === 0) { ts.forEachChild(declaration, visitClass); return; }
      const rewriteDerivedCallbacks = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
            isFactoryCall(node.expression, derivedFactories, file, program) && node.arguments.length > 0 &&
            (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
          const callback = node.arguments[0];
          const visitCallback = child => {
            if (ts.isPropertyAccessExpression(child) && child.expression.kind === ts.SyntaxKind.ThisKeyword &&
                atoms.has(child.name.text)) {
              if (ts.isPropertyAccessExpression(child.parent) && child.parent.expression === child &&
                  child.parent.name.text === "value") return;
              edits.push({ start: child.getStart(file), end: child.end, text: child.getText(file) + ".value" });
              return;
            }
            if (ts.isIdentifier(child) && atoms.has(child.text) &&
                !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) &&
                !(ts.isPropertyAccessExpression(child.parent) && child.parent.expression === child && child.parent.name.text === "value") &&
                !ts.isShorthandPropertyAssignment(child.parent)) {
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
          const offset = template.getStart(file) + 1;
          const raw = source.slice(offset, template.end - 1);
          for (const edit of rewriteTemplateEdits(raw, atoms)) {
            edits.push({ start: offset + edit.start, end: offset + edit.end, text: edit.text });
          }
        }
      }
      ts.forEachChild(declaration, visitClass);
    };
    ts.forEachChild(file, visitClass);
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
      if (position <= mapping[end]) {
        // Positions inside an expanded identifier retain their original
        // offset; only the appended `.value` tail maps to its end.
        return mapping[targetStart] + Math.min(position - mapping[start],
          mapping[targetEnd] - mapping[targetStart]);
      }
      delta += (mapping[targetEnd] - mapping[targetStart]) - (mapping[end] - mapping[start]);
    }
    return Math.max(0, position + delta);
  }

  /** Match a control-flow header, ignoring nested calls and quoted parentheses. */
  function closingParen(text, open) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = open; index < text.length; index++) {
      const ch = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) return index;
    }
    return -1;
  }

  /** Return source-relative edits so hover/navigation offsets stay precise. */
  function rewriteTemplateEdits(template, atoms) {
    const edits = [];
    const addExpression = (expression, offset) => {
      for (const edit of rewriteExpression(expression, atoms, true)) {
        edits.push({ start: offset + edit.start, end: offset + edit.end, text: edit.text });
      }
    };
    const header = /@(?:else\s+)?(?:if|switch|for)\s*\(/g;
    for (const match of template.matchAll(header)) {
      const start = match.index + match[0].length;
      const close = closingParen(template, start - 1);
      if (close < 0 || !/^\s*\{/.test(template.slice(close + 1))) continue;
      const original = template.slice(start, close);
      if (/\bfor\s*\($/.test(match[0])) {
        const loop = /^(\s*[\w$]+\s+of\s+)([^;]+)([\s\S]*)$/.exec(original);
        if (loop) addExpression(loop[2], start + loop[1].length);
      } else addExpression(original, start);
    }
    for (const match of template.matchAll(/(@let\s+[\w$]+\s*=\s*)([^;]+);/g)) {
      addExpression(match[2], match.index + match[1].length);
    }
    for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      addExpression(match[1], match.index + 2);
    }
    for (const match of template.matchAll(/((?:\[\([\w.-]+\)\]|\[[\w.-]+\]|\([\w.-]+\))\s*=\s*)(["'])([\s\S]*?)\2/g)) {
      addExpression(match[3], match.index + match[1].length + 1);
    }
    return edits.sort((a, b) => a.start - b.start);
  }

  /**
   * TypeScript syntax-aware expression lowering. Its edits are restricted to
   * actual identifier nodes, never strings, comments, or property names.
   * Assignment lowering mirrors the compiler's Streamix writer semantics.
   */
  function rewriteExpression(expression, atoms, returnEdits = false) {
    const prefix = 'const __sxExpression = (';
    const suffix = ');';
    const file = ts.createSourceFile('sx-template-expression.ts', prefix + expression + suffix,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = file.statements[0]?.declarationList?.declarations?.[0];
    if (!declaration?.initializer || file.parseDiagnostics.length) return returnEdits ? [] : expression;
    const edits = [];
    const add = (node, text) => {
      const start = node.getStart(file) - prefix.length;
      const end = node.end - prefix.length;
      if (start >= 0 && end <= expression.length) edits.push({ start, end, text });
    };
    const compound = new Map([
      [ts.SyntaxKind.PlusEqualsToken, '+'], [ts.SyntaxKind.MinusEqualsToken, '-'],
      [ts.SyntaxKind.AsteriskEqualsToken, '*'], [ts.SyntaxKind.SlashEqualsToken, '/'],
      [ts.SyntaxKind.PercentEqualsToken, '%'],
    ]);
    const visit = node => {
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && atoms.has(node.left.text) &&
          (node.operatorToken.kind === ts.SyntaxKind.EqualsToken || compound.has(node.operatorToken.kind))) {
        const name = node.left.text;
        const right = rewriteExpression(node.right.getText(file), atoms);
        const operator = compound.get(node.operatorToken.kind);
        add(node, `${name}.next(${operator ? `${name}.value ${operator} (${right})` : right})`);
        return;
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          ts.isIdentifier(node.operand) && atoms.has(node.operand.text) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        const name = node.operand.text;
        add(node, `${name}.next(${name}.value ${node.operator === ts.SyntaxKind.PlusPlusToken ? '+' : '-'} 1)`);
        return;
      }
      if (ts.isShorthandPropertyAssignment(node) && atoms.has(node.name.text)) {
        add(node, `${node.name.text}: ${node.name.text}.value`);
        return;
      }
      if (ts.isIdentifier(node) && atoms.has(node.text)) {
        const parent = node.parent;
        if ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
            (ts.isPropertyAccessExpression(parent) && parent.expression === node &&
              (parent.name.text === 'value' || parent.name.text === 'next' || parent.name.text === 'set')) ||
            (ts.isPropertyAssignment(parent) && parent.name === node) ||
            (ts.isParameter(parent) && parent.name === node) ||
            (ts.isVariableDeclaration(parent) && parent.name === node)) return;
        // A template callback can shadow a component atom with a parameter.
        let enclosing = parent;
        while (enclosing && enclosing !== declaration) {
          if (ts.isFunctionLike(enclosing) && enclosing.parameters.some(param =>
            ts.isIdentifier(param.name) && param.name.text === node.text)) return;
          enclosing = enclosing.parent;
        }
        add(node, `${node.text}.value`);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration.initializer);
    if (returnEdits) return edits;
    let result = expression;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
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
      const documentFor = fileName => {
        // Editor actions can arrive before the delegated language service has
        // requested the transformed script snapshot for this particular file.
        if (!documents.has(fileName)) host.getScriptSnapshot(fileName);
        return documents.get(fileName);
      };
      const originalPosition = (fileName, position) => documentFor(fileName)?.toOriginal(position) ?? position;
      const generatedPosition = (fileName, position) => documentFor(fileName)?.toGenerated(position) ?? position;
      const originalSpan = (fileName, span) => {
        if (!span) return span;
        const start = originalPosition(fileName, span.start);
        const end = originalPosition(fileName, span.start + span.length);
        return { ...span, start, length: Math.max(0, end - start) };
      };
      const mapDiagnostic = (fileName, diagnostic) => diagnostic.start === undefined
        ? diagnostic : { ...diagnostic, ...originalSpan(fileName,
          { start: diagnostic.start, length: diagnostic.length ?? 0 }) };
      for (const method of ['getSemanticDiagnostics', 'getSyntacticDiagnostics', 'getSuggestionDiagnostics']) {
        if (typeof service[method] === 'function') {
          proxy[method] = fileName => service[method](fileName).map(d => mapDiagnostic(fileName, d));
        }
      }
      for (const method of ['getQuickInfoAtPosition', 'getRenameInfo']) {
        if (typeof service[method] === 'function') {
          proxy[method] = (fileName, position, ...args) => {
            const result = service[method](fileName, generatedPosition(fileName, position), ...args);
            return result && result.textSpan ? { ...result, textSpan: originalSpan(fileName, result.textSpan),
              ...(result.triggerSpan ? { triggerSpan: originalSpan(fileName, result.triggerSpan) } : {}) } : result;
          };
        }
      }
      if (typeof service.getCompletionsAtPosition === 'function') {
        proxy.getCompletionsAtPosition = (fileName, position, ...args) => {
          const result = service.getCompletionsAtPosition(fileName, generatedPosition(fileName, position), ...args);
          return result ? { ...result, entries: result.entries?.map(entry => ({ ...entry,
            replacementSpan: originalSpan(fileName, entry.replacementSpan) })) } : result;
        };
      }
      const mapLocation = entry => entry && entry.fileName && entry.textSpan
        ? { ...entry, textSpan: originalSpan(entry.fileName, entry.textSpan),
            ...(entry.contextSpan ? { contextSpan: originalSpan(entry.fileName, entry.contextSpan) } : {}),
            ...(entry.originalTextSpan ? { originalTextSpan: originalSpan(entry.fileName, entry.originalTextSpan) } : {}) }
        : entry;
      for (const method of ['getDefinitionAtPosition', 'getTypeDefinitionAtPosition',
          'getImplementationAtPosition', 'getReferencesAtPosition', 'findRenameLocations']) {
        if (typeof service[method] === 'function') {
          proxy[method] = (fileName, position, ...args) => {
            const result = service[method](fileName, generatedPosition(fileName, position), ...args);
            return Array.isArray(result) ? result.map(mapLocation) : result;
          };
        }
      }
      if (typeof service.findReferences === 'function') {
        proxy.findReferences = (fileName, position, ...args) => {
          const result = service.findReferences(fileName, generatedPosition(fileName, position), ...args);
          return result?.map(group => ({ ...group, definition: mapLocation(group.definition),
            references: group.references?.map(mapLocation) })) ?? result;
        };
      }
      if (typeof service.getDefinitionAndBoundSpan === 'function') {
        proxy.getDefinitionAndBoundSpan = (fileName, position, ...args) => {
          const result = service.getDefinitionAndBoundSpan(fileName, generatedPosition(fileName, position), ...args);
          return result ? { ...result, textSpan: originalSpan(fileName, result.textSpan),
            definitions: result.definitions?.map(mapLocation) } : result;
        };
      }
      return proxy;
    },
    getExternalFiles: angularPlugin.getExternalFiles,
    // Kept internal; exercised to ensure the virtual document used by the
    // Angular LS has the same atom-value semantics as the build transform.
    __streamixVirtualize: virtualize,
  };
};
