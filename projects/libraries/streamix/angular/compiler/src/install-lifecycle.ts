import ts from 'typescript';

import {
  SX_SETUP_RUNTIME_SYMBOLS,
  emitComponentFieldInitializers,
  emitLifecycleInitializer,
} from './emit-component-module';
import { SX_SOURCE_REFERENCES_FIELD } from './generated-names';

export interface SxComponentSourceTransformOptions {
  /**
   * Generated setup function, inlined into the component module so the
   * component never imports a generated file.
   */
  readonly inlineSetup?: string;
  readonly setupName?: string;
  readonly runtimeImport?: string;
  readonly sourceReferenceFields?: readonly string[];
}

export interface SxComponentSourceTransformResult {
  readonly source: string;
  readonly changed: boolean;
}

const GENERATED_VIEW_FIELD = 'ɵsx';

/**
 * Adds the generated sx runtime import, the compiled-view field, and the
 * source-reference bridge to a component class.
 *
 * The whole file is parsed as TypeScript and edited through the AST, so
 * class shapes the previous string scanner refused — generics, `abstract`,
 * `export default` — install correctly, and idempotence is decided by what the
 * class actually declares rather than by text that merely looks like it.
 */
export function installSxLifecycleIntoComponentSource(
  source: string,
  options: SxComponentSourceTransformOptions,
): SxComponentSourceTransformResult {
  const setupName = options.setupName ?? 'ɵsetupSxBindings';
  const runtimeImport =
    options.runtimeImport ?? '@epikodelabs/streamix/angular';
  const sourceReferences = options.sourceReferenceFields ?? [];
  const hasSetup = !!options.inlineSetup;

  if (!hasSetup && sourceReferences.length === 0) {
    return { source, changed: false };
  }

  const file = ts.createSourceFile(
    'component.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const classNode = findComponentClass(file);

  if (!classNode) {
    throw new Error(
      'Unable to install sx lifecycle: no conventional exported component class was found.',
    );
  }

  const declaredMembers = new Set(
    classNode.members
      .map(member => memberName(member))
      .filter((name): name is string => !!name),
  );

  if (
    declaredMembers.has(GENERATED_VIEW_FIELD) ||
    (hasSetup && declaresFunction(file, setupName))
  ) {
    return { source, changed: false };
  }

  if (
    sourceReferences.length > 0 &&
    declaredMembers.has(SX_SOURCE_REFERENCES_FIELD)
  ) {
    throw new Error(
      `Unable to install sx lifecycle: component member ${SX_SOURCE_REFERENCES_FIELD} is reserved for generated Streamix source references.`,
    );
  }

  const runtimeSymbols = [
    ...(hasSetup ? ['ɵinstallSxCompiledView'] : []),
    ...(sourceReferences.length > 0 ? ['ɵinstallSxSourceReferences'] : []),
    ...(hasSetup ? runtimeSymbolsForSetup(options.inlineSetup!) : []),
  ];

  const generated = hasSetup
    ? emitLifecycleInitializer(setupName, { sourceReferences })
    : emitComponentFieldInitializers({ sourceReferences });

  const members = [...classNode.members];

  if (hasSetup) {
    // Server rendering mounts the compiled view from `ngAfterViewInit`,
    // because `afterNextRender` is a no-op under `ngServerMode`. An authored
    // lifecycle method keeps its body; the mount call runs first.
    const hookIndex = members.findIndex(
      member =>
        ts.isMethodDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'ngAfterViewInit',
    );

    if (hookIndex >= 0) {
      members[hookIndex] = withMountCall(
        members[hookIndex] as ts.MethodDeclaration,
      );
    } else {
      members.push(createMountHook(hasBaseClass(classNode)));
    }
  }

  members.push(...parseClassMembers(generated));

  const updatedClass = ts.factory.updateClassDeclaration(
    classNode,
    classNode.modifiers,
    classNode.name,
    classNode.typeParameters,
    classNode.heritageClauses,
    members,
  );

  const statements = file.statements.map(statement =>
    statement === classNode ? updatedClass : statement,
  );

  const withImports = mergeRuntimeImports(statements, runtimeSymbols, runtimeImport);
  const printed = printStatements(file, [
    ...withImports,
    ...(hasSetup ? parseStatements(options.inlineSetup!) : []),
  ]);

  return { source: printed, changed: true };
}

/** The exported class declaration, named or default. */
function findComponentClass(
  file: ts.SourceFile,
): ts.ClassDeclaration | undefined {
  let exportedClass: ts.ClassDeclaration | undefined;

  for (const statement of file.statements) {
    if (!ts.isClassDeclaration(statement)) {
      continue;
    }

    const exported = ts.getModifiers(statement)?.some(
      modifier =>
        modifier.kind === ts.SyntaxKind.ExportKeyword ||
        modifier.kind === ts.SyntaxKind.DefaultKeyword,
    );

    const component = ts.getDecorators(statement)?.some(decorator => {
      const expression = decorator.expression;
      return ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'Component';
    });

    if (exported && component) {
      return statement;
    }

    // Keep the standalone transformation API compatible with its historical
    // class-only input, but prefer an actual decorated component whenever the
    // source file contains one.
    if (exported && !exportedClass) {
      exportedClass = statement;
    }
  }

  return exportedClass;
}

function memberName(member: ts.ClassElement): string | undefined {
  const name = member.name;

  if (!name) {
    return undefined;
  }

  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }

  return undefined;
}

function declaresFunction(file: ts.SourceFile, name: string): boolean {
  return file.statements.some(
    statement =>
      (ts.isFunctionDeclaration(statement) ||
        ts.isVariableStatement(statement)) &&
      statementName(statement) === name,
  );
}

function statementName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return statement.name.text;
  }

  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0];

    return declaration && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined;
  }

  return undefined;
}

/** `this.ɵsx.ɵafterViewInit();` */
function mountCall(): ts.Statement {
  return ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createThis(),
          GENERATED_VIEW_FIELD,
        ),
        'ɵafterViewInit',
      ),
      undefined,
      [],
    ),
  );
}

function withMountCall(method: ts.MethodDeclaration): ts.MethodDeclaration {
  const body = method.body ?? ts.factory.createBlock([], true);

  return ts.factory.updateMethodDeclaration(
    method,
    method.modifiers,
    method.asteriskToken,
    method.name,
    method.questionToken,
    method.typeParameters,
    method.parameters,
    method.type,
    ts.factory.updateBlock(body, [mountCall(), ...body.statements]),
  );
}

function createMountHook(hasBaseClass: boolean): ts.MethodDeclaration {
  const statements: ts.Statement[] = [];
  if (hasBaseClass) {
    // A base component need not declare Angular's lifecycle interface in its
    // TypeScript type. Resolve the hook dynamically, but invoke it with this
    // component as its receiver just as a normal super call would.
    const baseHook = ts.factory.createIdentifier('__streamixBaseAfterViewInit');
    statements.push(ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(baseHook, undefined, undefined,
        ts.factory.createPropertyAccessExpression(
          ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Object'), 'getPrototypeOf'),
            undefined,
            [ts.factory.createCallExpression(
              ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Object'), 'getPrototypeOf'),
              undefined,
              [ts.factory.createThis()],
            )],
          ),
          'ngAfterViewInit',
        )),
    ], ts.NodeFlags.Const)));
    statements.push(ts.factory.createExpressionStatement(ts.factory.createCallChain(
      ts.factory.createPropertyAccessChain(baseHook, ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), 'call'),
      ts.factory.createToken(ts.SyntaxKind.QuestionDotToken),
      undefined,
      [ts.factory.createThis()],
    )));
  }
  statements.push(mountCall());
  return ts.factory.createMethodDeclaration(
    undefined,
    undefined,
    'ngAfterViewInit',
    undefined,
    undefined,
    [],
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
    ts.factory.createBlock(statements, true),
  );
}

function hasBaseClass(node: ts.ClassDeclaration): boolean {
  return node.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ExtendsKeyword) ?? false;
}

/** Parses emitter-produced member text into class element declarations. */
function parseClassMembers(memberText: string): readonly ts.ClassElement[] {
  if (!memberText.trim()) {
    return [];
  }

  const parsed = ts.createSourceFile(
    'members.ts',
    `class SxGenerated {\n${memberText}\n}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const holder = parsed.statements.find(ts.isClassDeclaration);

  if (!holder) {
    throw new Error('Unable to parse generated sx component members.');
  }

  return holder.members.map(member => synthesize(member));
}

/** Parses emitter-produced statements (the setup function). */
function parseStatements(statementText: string): readonly ts.Statement[] {
  if (!statementText.trim()) {
    return [];
  }

  const parsed = ts.createSourceFile(
    'setup.ts',
    statementText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return parsed.statements.map(statement => synthesize(statement));
}

/**
 * Clears the text ranges of nodes parsed from a scratch file. Without this the
 * printer reads their original text out of the wrong source and interleaves
 * the output with unrelated fragments.
 */
function synthesize<T extends ts.Node>(node: T): T {
  const transformed = ts.transform(node, [
    context => root => {
      const visit = (current: ts.Node): ts.Node => {
        ts.setTextRange(current, { pos: -1, end: -1 });
        return ts.visitEachChild(current, visit, context);
      };

      return visit(root) as T;
    },
  ]);

  return transformed.transformed[0] as T;
}

function printStatements(
  file: ts.SourceFile,
  statements: readonly ts.Statement[],
): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  return printer.printFile(
    ts.factory.updateSourceFile(file, [...statements]),
  );
}

/**
 * Merge the generated bindings into an existing named import, or add one.
 * A namespace import cannot supply unqualified generated references and is
 * deliberately left intact beside the new named import.
 */
function mergeRuntimeImports(
  statements: readonly ts.Statement[],
  symbols: readonly string[],
  moduleName: string,
): readonly ts.Statement[] {
  const required = new Set(symbols);
  let mergeIndex = -1;
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index];
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== moduleName || !statement.importClause) continue;
    const bindings = statement.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    if (mergeIndex < 0 && !statement.importClause.isTypeOnly) mergeIndex = index;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly && !element.propertyName) required.delete(element.name.text);
    }
  }
  if (required.size === 0) return statements;
  const additions = [...required].map(name =>
    ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name)));
  if (mergeIndex >= 0) {
    const result = [...statements];
    const statement = result[mergeIndex] as ts.ImportDeclaration;
    const clause = statement.importClause!;
    const named = clause.namedBindings as ts.NamedImports;
    result[mergeIndex] = ts.factory.updateImportDeclaration(
      statement, statement.modifiers,
      ts.factory.updateImportClause(clause, false, clause.name,
        ts.factory.updateNamedImports(named, [...named.elements, ...additions])),
      statement.moduleSpecifier, statement.attributes,
    );
    return result;
  }
  const generated = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(false, undefined, ts.factory.createNamedImports(additions)),
    ts.factory.createStringLiteral(moduleName),
  );
  return [generated, ...statements];
}

/** Only include references to actual identifiers, not strings or comments. */
function runtimeSymbolsForSetup(setup: string): readonly string[] {
  const required = new Set<string>();
  const candidates = new Set<string>(SX_SETUP_RUNTIME_SYMBOLS);
  const tree = ts.createSourceFile('sx-setup.ts', setup, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && candidates.has(node.text) &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
      required.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return SX_SETUP_RUNTIME_SYMBOLS.filter(name => required.has(name));
}
