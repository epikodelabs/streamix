import ts from 'typescript';

export interface SxIntrospectionTransformOptions {
  readonly file: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly sourcePath: string;
  readonly enabled: boolean;
}

/** Inserts metadata around original calls without reprinting or re-evaluating them. */
export function instrumentStreamixSource({ file, checker, sourcePath, enabled }: SxIntrospectionTransformOptions): string {
  if (!enabled) return file.text;
  let helper = '__sxDebug';
  let subscribeHelper = '__sxSubscribe';
  while (new RegExp('\\b(' + helper + '|' + subscribeHelper + ')\\b').test(file.text)) { helper += '_'; subscribeHelper += '_'; }
  let usesDebug = false;
  let usesSubscribe = false;
  const removals = new Map<number, number>();
  const inserts = new Map<number, string[]>();
  const insert = (offset: number, text: string) => inserts.set(offset, [...inserts.get(offset) ?? [], text]);
  const location = (node: ts.Node) => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { file: sourcePath.replace(/\\/g, '/'), line: position.line + 1, column: position.character + 1 };
  };
  function imported(node: ts.Expression): string | undefined {
    const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
    if (!symbol) return undefined;
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) {
        const module = declaration.parent.parent.parent.moduleSpecifier;
        if (ts.isStringLiteral(module) && /^@epikodelabs\/streamix(?:\/|$)/.test(module.text)) return (declaration.propertyName ?? declaration.name).text;
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const namespace = checker.getSymbolAtLocation(node.expression);
      if (namespace?.declarations?.some(declaration => ts.isNamespaceImport(declaration) &&
        ts.isStringLiteral(declaration.parent.parent.moduleSpecifier) &&
        /^@epikodelabs\/streamix(?:\/|$)/.test(declaration.parent.parent.moduleSpecifier.text))) return node.name.text;
    }
    return undefined;
  }
  function context(node: ts.Node) {
    const parts: string[] = [];
    const classes: string[] = [];
    let binding: string | undefined;
    let member = false;
    let bound = false;
    const fields: string[] = [];
    const direct = (value: ts.Node | undefined): boolean => {
      while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isNonNullExpression(value))) value = value.expression;
      return value === node;
    };
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (!binding && ts.isPropertyAssignment(ancestor) && !ts.isComputedPropertyName(ancestor.name)) {
        fields.unshift(ancestor.name.getText(file).replace(/^['"]|['"]$/g, ''));
        bound ||= direct(ancestor.initializer);
      }
      if (!binding && (ts.isVariableDeclaration(ancestor) || ts.isPropertyDeclaration(ancestor))) {
        binding = [ancestor.name.getText(file), ...fields].join('.');
        member = ts.isPropertyDeclaration(ancestor);
        bound ||= direct(ancestor.initializer);
      }
      if (!binding && ts.isBinaryExpression(ancestor) && ancestor.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        binding = ancestor.left.getText(file).replace(/^this\./, '');
        member = ts.isPropertyAccessExpression(ancestor.left) && ancestor.left.expression.kind === ts.SyntaxKind.ThisKeyword;
        bound ||= direct(ancestor.right);
      }
      if ((ts.isMethodDeclaration(ancestor) || ts.isFunctionDeclaration(ancestor) || ts.isClassDeclaration(ancestor)) && ancestor.name) parts.unshift(ancestor.name.getText(file));
      if (ts.isClassDeclaration(ancestor) && ancestor.name) classes.unshift(ancestor.name.text);
    }
    const ownerClass = classes.join('.') || undefined;
    return { enclosing: parts.join('.'), binding, member, bound, ownerClass,
      prefix: member && ownerClass ? ownerClass : parts.join('.') };
  }
  function metadataFor(node: ts.CallExpression, kind: string, factory: string) {
    const contextInfo = context(node);
    const site = location(node);
    const literal = factory === 'on' ? node.expression.getText(file) + '(' + (node.arguments[0]?.getText(file) ?? '') + ')' : factory;
    const suffix = contextInfo.bound && contextInfo.binding ? contextInfo.binding : literal + '@' + site.line + ':' + site.column;
    // A field belongs to the class; its method is only the creation context.
    const prefix = contextInfo.bound ? contextInfo.prefix : contextInfo.ownerClass ?? contextInfo.enclosing;
    return { kind, name: [prefix, suffix].filter(Boolean).join('.'), enclosing: contextInfo.enclosing,
      ...(contextInfo.ownerClass ? { ownerClass: contextInfo.ownerClass } : {}),
      ...(contextInfo.member && contextInfo.bound ? { field: contextInfo.binding } : {}), ...site };
  }

  function members(config: ts.ObjectLiteralExpression, parent: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const property of config.properties) {
      if ((!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) || ts.isComputedPropertyName(property.name)) continue;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(file);
      const name = parent + '.' + key;
      const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name;
      const factory = ts.isCallExpression(initializer) ? imported(initializer.expression) : undefined;
      const kind = ts.isObjectLiteralExpression(initializer) || factory === 'scope' ? 'scope'
        : ['derived', 'derivedExpr'].includes(factory ?? '') || ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) ? 'derived'
        : ['flow', 'flowExpr', 'pipe', 'pipeExpr', 'atomFromIterator'].includes(factory ?? '') ? 'flow' : 'atom';
      result[key] = { kind, name, ...location(property), ...(ts.isObjectLiteralExpression(initializer) ? { members: members(initializer, name) } : {}) };
    }
    return result;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'subscribe' &&
          !node.questionDotToken && !node.expression.questionDotToken) {
        const receiver = node.expression.expression;
        const type = checker.getTypeAtLocation(receiver);
        const discriminator = type.getProperty('type');
        if (discriminator && checker.typeToString(checker.getTypeOfSymbolAtLocation(discriminator, receiver)) === '"atom"') {
          const metadata = { ...metadataFor(node, 'subscription', 'subscribe'), ...location(node.expression.name) };
          insert(receiver.getStart(file), subscribeHelper + '(');
          insert(receiver.end, ', ' + JSON.stringify(metadata) + ')');
          removals.set(receiver.end, node.expression.end - receiver.end);
          usesSubscribe = true;
        }
      }
      const factory = imported(node.expression);
      if (factory) {
        const type = checker.getTypeAtLocation(node);
        const kind = factory === 'scope' ? 'scope' : ['pipe', 'flow', 'atomFromIterator'].includes(factory) ? 'flow'
          : factory === 'derived' ? 'derived' : factory === 'atom' ? 'atom'
          : type.getProperty('apply') ? 'operator' : type.getProperty('subscribe') && type.getProperty('value') ? 'source' : undefined;
        if (kind) {
          const base = metadataFor(node, kind, factory);
          let config = node.arguments[0];
          if (config && (ts.isArrowFunction(config) || ts.isFunctionExpression(config))) {
            const body = config.body;
            config = ts.isBlock(body) ? body.statements.find(ts.isReturnStatement)?.expression! : body;
          }
          while (config && ts.isParenthesizedExpression(config)) config = config.expression;
          const metadata = { ...base,
            ...(kind === 'scope' && config && ts.isObjectLiteralExpression(config)
              ? { members: members(config, base.name) } : {}) };
          usesDebug = true;
          insert(node.getStart(file), helper + '(');
          // Inner calls must close before outer calls ending at the same offset.
          insert(node.end, ', ' + JSON.stringify(metadata) + ')');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!inserts.size) return file.text;
  let result = file.text;
  for (const offset of [...inserts.keys()].sort((a, b) => b - a)) {
    const texts = inserts.get(offset)!;
    const text = texts[0].startsWith(', ') ? texts.reverse().join('') : texts.join('');
    result = result.slice(0, offset) + text + result.slice(offset + (removals.get(offset) ?? 0));
  }
  const imports = [usesDebug ? `__streamixDebug as ${helper}` : '', usesSubscribe ? `__streamixSubscribe as ${subscribeHelper}` : ''].filter(Boolean);
  return `import { ${imports.join(', ')} } from '@epikodelabs/streamix';\n` + result;
}
