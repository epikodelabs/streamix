import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { applyMappedEdits, insertMappedText, createVueSourceMap, type VueSourceMap } from './source-map';

export interface VueSfcDiagnostic {
  readonly category: 'error' | 'warning';
  readonly message: string;
  /** Offset within the whole SFC source; -1 when not positionable. */
  readonly start: number;
  readonly length: number;
}

export interface VueSfcTransformResult {
  /** Transformed SFC source. */
  readonly code: string;
  /** Number of adopted reactive declarations, wrapped scopes, and bridged scope members. */
  readonly bindingCount: number;
  /** Scope members the compiler bridged, keyed by scope name. */
  readonly bridgedScopes: Readonly<Record<string, readonly string[]>>;
  /** Diagnostics for syntax the compiler refuses to rewrite. */
  readonly diagnostics: readonly VueSfcDiagnostic[];
  /** Accurate mappings for unchanged authored SFC text; inserted code is unmapped. */
  readonly sourceMap?: VueSourceMap;
}

/** Formats transform diagnostics with a source location and one-line frame. */
export function formatVueSfcDiagnostics(
  source: string,
  fileName: string,
  diagnostics: readonly VueSfcDiagnostic[],
): string {
  // Keep each line terminator so offsets remain offsets into the original
  // source. Splitting CRLF as one character made every later column drift by
  // one on Windows-authored SFCs.
  const lines = source.match(/.*(?:\r\n|\n|\r)|.+$/g) ?? [''];

  return diagnostics.map(diagnostic => {
    if (diagnostic.start < 0) {
      return `${fileName} - ${diagnostic.category}: ${diagnostic.message}`;
    }

    let offset = 0;
    let lineIndex = 0;
    while (lineIndex < lines.length && offset + lines[lineIndex].length <= diagnostic.start) {
      offset += lines[lineIndex].length;
      lineIndex++;
    }
    const column = diagnostic.start - offset;
    const line = (lines[lineIndex] ?? '').replace(/[\r\n]+$/, '');
    return `${fileName}:${lineIndex + 1}:${column + 1} - ${diagnostic.category}: ${diagnostic.message}\n` +
      `  ${line}\n  ${' '.repeat(Math.max(0, column))}^`;
  }).join('\n');
}

interface FactoryImports {
  aliases: Map<string, FactoryKind>;
}

type FactoryKind = 'atom' | 'derived' | 'flow' | 'scope';

interface ReactiveDeclaration {
  /** Declared binding name. */
  readonly name: string;
  readonly kind: FactoryKind;
  /** Declaration offsets within the script-setup content. */
  readonly callExpressionStart: number;
  /** Offset just past the factory call (the scope-bridge insertion point). */
  readonly callEnd: number;
  /** Offset just past the containing variable statement. */
  readonly statementEnd: number;
  /** Body span of a `derived` callback, when statically available. */
  /** The function, not only its body, is needed for parameter shadowing. */
  readonly derivedCallbackStart?: number;
  readonly derivedCallbackEnd?: number;
  /** Scope object-literal member names, for scope declarations. */
  readonly members: readonly string[];
}

interface SpanEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

interface ScopeMemberRead {
  readonly start: number;
  readonly end: number;
  readonly scope: string;
  readonly member: string;
}

interface ScopeMemberWrite {
  readonly start: number;
  readonly end: number;
  readonly scope: string;
  readonly member: string;
  readonly rhs: string;
}

interface TemplateUsage {
  readonly reads: readonly ScopeMemberRead[];
  readonly writes: readonly ScopeMemberWrite[];
}

const STREAMIX_MODULE = /^@epikodelabs\/streamix(?:\/|$)/;
const FACTORY_NAMES = new Set<FactoryKind>(['atom', 'derived', 'flow', 'scope']);
const BRIDGE_PREFIX = '__sx_';
/** Composables the compiler emits; the import inserter only ships used ones. */
const BRIDGE_COMPOSABLES = new Set(['useIterable', 'useScope', 'useWritable']);

/** v-model element/prop mapping, mirroring the Angular two-way allow-list. */
const V_MODEL_NATIVE: Readonly<Record<string, { prop: string; event: string; value: string }>> = {
  input: { prop: 'value', event: 'input', value: '$event.target.value' },
  textarea: { prop: 'value', event: 'input', value: '$event.target.value' },
  select: { prop: 'value', event: 'change', value: '$event.target.value' },
};

/**
 * Compiles a Vue single-file component that declares raw Streamix atoms,
 * deriveds, flows, and scopes in `<script setup>`.
 *
 * Raw declarations are rewritten onto the Vue bridge composables: writable
 * atoms become `useWritable` (reads track; template assignments and
 * `v-model` emit through the computed setter via Vue's setup-binding proxy),
 * deriveds and flows become `useIterable`, every scope member the template
 * touches is bridged as its own read-only ref with member writes and
 * `v-model` lowered to `scope.set(...)`, and each scope itself is wrapped in
 * `useScope(...)` so its lifetime is tied to the component. Vue's native
 * setup auto-unwrap then makes templates read and write the atoms as
 * ordinary state — no manual composable calls and no copies of Streamix
 * state into Vue stores.
 */
export function transformVueSfc(
  source: string,
  fileName = 'component.vue',
): VueSfcTransformResult {
  const diagnostics: VueSfcDiagnostic[] = [];
  const parsed = parseSfc(source, { filename: fileName });

  if (parsed.errors.length > 0) {
    return {
      code: source,
      bindingCount: 0,
      bridgedScopes: {},
      diagnostics: parsed.errors.map(error => ({
        category: 'error' as const,
        message: error.message ?? String(error),
        start: -1,
        length: 0,
      })),
    };
  }

  const descriptor = parsed.descriptor;
  const scriptSetup = descriptor.scriptSetup;

  if (!scriptSetup || !descriptor.template) {
    return { code: source, bindingCount: 0, bridgedScopes: {}, diagnostics };
  }

  const scriptOffset = scriptSetup.loc.start.offset;
  const scriptContent = scriptSetup.content;
  const templateOffset = descriptor.template.loc.start.offset;
  const templateContent = descriptor.template.content;

  const imports = factoryImports(scriptContent);
  const declarations = collectReactiveDeclarations(scriptContent, imports);

  if (declarations.length === 0) {
    return { code: source, bindingCount: 0, bridgedScopes: {}, diagnostics };
  }

  diagnostics.push(...unsupportedTemplateDiagnostics(templateContent, templateOffset, declarations));
  diagnostics.push(...readonlyTemplateDiagnostics(templateContent, templateOffset, declarations));
  diagnostics.push(...generatedNameDiagnostics(scriptContent, scriptOffset, declarations));

  const templateUsage = collectTemplateUsage(templateContent, declarations);
  const vModelBindings = collectVModelScopeBindings(templateContent, declarations);
  const usage: TemplateUsage = {
    reads: [
      ...templateUsage.reads,
      // v-model owns its whole attribute span below. Adding it here would
      // create a second, overlapping replacement.
    ],
    writes: templateUsage.writes,
  };
  const scopes = declarations.filter(
    (declaration): declaration is ReactiveDeclaration & { members: readonly string[] } =>
      declaration.kind === 'scope',
  );
  const reactive = declarations.filter(declaration => declaration.kind !== 'scope');
  const bridgedScopes: Record<string, readonly string[]> = {};

  const scriptEdits: SpanEdit[] = [];
  const templateEdits: SpanEdit[] = [];

  // Keep authored declarations as raw Streamix sources. Vue-facing bindings
  // are separate names, so `derived(() => price * quantity)` still closes
  // over raw atoms rather than Vue computed refs.
  for (const declaration of reactive) {
    const bridge = declaration.kind === 'atom' ? 'useWritable' : 'useIterable';

    scriptEdits.push({
      start: declaration.statementEnd,
      end: declaration.statementEnd,
      replacement: `\nconst ${reactiveBridgeName(declaration.name)} = ${bridge}(${declaration.name});`,
    });
  }

  for (const edit of derivedAtomValueReadEdits(scriptContent, reactive)) {
    scriptEdits.push(edit);
  }

  const writeSpans = templateUsage.writes.map(write => ({ start: write.start, end: write.end }));
  for (const read of collectTemplateReactiveReads(templateContent, reactive)) {
    // A scope write replaces its complete expression. Its RHS is rewritten as
    // part of that replacement, so an independent nested edit would shift the
    // outer span and corrupt the SFC.
    if (insideAny(read, writeSpans)) continue;
    templateEdits.push({
      start: read.start,
      end: read.end,
      replacement: read.replacement ?? reactiveBridgeName(read.name),
    });
  }

  // A scope declared in setup is component-owned, so the compiler wraps the
  // authored call in `useScope(...)` rather than asking for it by hand: the
  // scope is disposed with the component's effect scope instead of outliving
  // the component. Zero-length insertions keep the authored call mapped.
  for (const scope of scopes) {
    scriptEdits.push({
      start: scope.callExpressionStart,
      end: scope.callExpressionStart,
      replacement: 'useScope(() => ',
    });
    scriptEdits.push({
      start: scope.callEnd,
      end: scope.callEnd,
      replacement: ')',
    });
  }

  for (const scope of scopes) {
    const used = [...new Set([...usedMembers(usage, scope.name), ...vModelBindings
      .filter(model => model.scope === scope.name).map(model => model.member)])].sort();
    const accepted: string[] = [];

    for (const member of used) {
      if (!scope.members.includes(member)) {
        diagnostics.push({
          category: 'error',
          message:
            `Scope member ${JSON.stringify(`${scope.name}.${member}`)} is not declared by the scope literal, ` +
            'so the compiler cannot bridge it.',
          start: templateOffset,
          length: templateContent.length,
        });
        continue;
      }

      accepted.push(member);
      scriptEdits.push({
        // Insert after the declaration statement, not inside the initializer.
        // This keeps multi-declarator statements syntactically valid.
        start: scope.statementEnd,
        end: scope.statementEnd,
        replacement:
          `\nconst ${bridgeName(scope.name, member)} = useIterable(` +
          `${scope.name}.get('${escapeSingleQuotes(member)}'));`,
      });
    }

    bridgedScopes[scope.name] = accepted;
  }

  // Scope-member reads rewrite to the bridged refs; Vue auto-unwraps
  // top-level setup refs, so the template expression text stays natural.
  const scopeWriteSpans = usage.writes.map(write => ({ start: write.start, end: write.end }));

  for (const read of usage.reads) {
    if (insideAny(read, scopeWriteSpans)) {
      continue;
    }

    if (!isBridged(bridgedScopes, read)) {
      continue;
    }

    templateEdits.push({
      start: read.start,
      end: read.end,
      replacement: bridgeName(read.scope, read.member),
    });
  }

  // Whole `scope.member = rhs` assignments lower to `scope.set(member, rhs)`;
  // reactive reads inside the right-hand side are rewritten in place first so
  // the replacement does not depend on edit ordering.
  for (const write of usage.writes) {
    templateEdits.push({
      start: write.start,
      end: write.end,
      replacement: `${write.scope}.set('${escapeSingleQuotes(write.member)}', ${write.rhs})`,
    });
  }

  // `v-model="scope.member"` lowers to the bridged value plus an explicit
  // scope write, mirroring the Angular two-way allow-list.
  for (const model of vModelBindings) {
    if (!isBridged(bridgedScopes, model)) {
      continue;
    }

    const bridge = bridgeName(model.scope, model.member);
    const inputType = /\btype\s*=\s*(["']?)([^\s"'>]+)\1/i.exec(model.attributes)?.[2]?.toLowerCase();
    const unsupportedNative =
      (model.element === 'input' && inputType !== undefined && !['text', 'search', 'email', 'url', 'tel', 'password'].includes(inputType)) ||
      (model.element === 'select' && /\bmultiple\b/i.test(model.attributes));
    const mapping = unsupportedNative ? undefined : V_MODEL_NATIVE[model.element];

    if (!mapping) {
      diagnostics.push({
        category: 'error',
        message:
          `v-model on <${model.element}> cannot be compiled for ${JSON.stringify(`${model.scope}.${model.member}`)}. ` +
          'Bind :value and an explicit scope.set(...) handler instead.',
        start: templateOffset + model.start,
        length: model.end - model.start,
      });
      continue;
    }

    templateEdits.push({
      start: model.start,
      end: model.end,
      replacement:
        `:${mapping.prop}="${bridge}" ` +
        `@${mapping.event}="${model.scope}.set('${escapeSingleQuotes(model.member)}', ${mapping.value})"`,
    });
  }

  const templateAndScriptEdits = [
    ...scriptEdits.map(edit => ({
      start: scriptOffset + edit.start,
      end: scriptOffset + edit.end,
      replacement: edit.replacement,
    })),
    ...templateEdits.map(edit => ({
      start: templateOffset + edit.start,
      end: templateOffset + edit.end,
      replacement: edit.replacement,
    })),
  ].sort((left, right) => right.start - left.start);

  const firstPass = applyMappedEdits(source, templateAndScriptEdits);
  const runtimeImport = withRuntimeImport(firstPass.code, templateAndScriptEdits.length > 0);
  const final = runtimeImport.insertion
    ? insertMappedText(firstPass, runtimeImport.insertion.offset, runtimeImport.insertion.text)
    : firstPass;
  const bindingCount =
    reactive.length + scopes.length + Object.values(bridgedScopes).flat().length;

  return {
    code: final.code,
    sourceMap: createVueSourceMap(source, final, fileName),
    bindingCount,
    bridgedScopes,
    diagnostics,
  };
}

function isAssignmentKind(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** Reject shapes the compiler cannot lower without changing Vue semantics. */
function unsupportedTemplateDiagnostics(
  template: string,
  templateOffset: number,
  declarations: readonly ReactiveDeclaration[],
): readonly VueSfcDiagnostic[] {
  const scopes = new Set(declarations.filter(item => item.kind === 'scope').map(item => item.name));
  const reactiveNames = new Set(declarations.filter(item => item.kind !== 'scope').map(item => item.name));
  const diagnostics: VueSfcDiagnostic[] = [];
  const add = (start: number, length: number, message: string): void => {
    diagnostics.push({ category: 'error', message, start: templateOffset + start, length });
  };

  for (const span of templateExpressionSpans(template)) {
    const expression = template.slice(span.start, span.end);
    const { file, prefix } = parseTemplateExpression(expression);
    const visit = (node: ts.Node): void => {
      const access = (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        ts.isIdentifier(node.expression) && scopes.has(node.expression.text)
        ? node : undefined;
      if (access && (ts.isElementAccessExpression(access) || access.questionDotToken)) {
        add(span.start + node.getStart(file) - prefix, node.end - node.getStart(file),
          `Unsupported dynamic scope access on ${(access.expression as ts.Identifier).text}. Use scope.get(...) in script and bind the returned ref.`);
      }
      let write: ts.Expression | undefined;
      if (ts.isBinaryExpression(node) && isAssignmentKind(node.operatorToken.kind) &&
          node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) write = node.left;
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) write = node.operand;
      if (write && ts.isPropertyAccessExpression(write) && ts.isIdentifier(write.expression) &&
          scopes.has(write.expression.text)) {
        add(span.start + write.getStart(file) - prefix, write.end - write.getStart(file),
          `Unsupported compound scope write on ${write.expression.text}. Use an explicit scope.set(...) handler.`);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression) &&
          scopes.has(node.left.expression.text)) {
        const containsNestedWrite = (child: ts.Node): boolean => {
          if (ts.isBinaryExpression(child) && isAssignmentKind(child.operatorToken.kind) &&
              ts.isPropertyAccessExpression(child.left) && ts.isIdentifier(child.left.expression) &&
              scopes.has(child.left.expression.text)) return true;
          return ts.forEachChild(child, containsNestedWrite) ?? false;
        };
        if (containsNestedWrite(node.right)) {
          add(span.start + node.getStart(file) - prefix, node.end - node.getStart(file),
            'Nested scope assignments are unsupported. Use separate scope.set(...) statements.');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  for (const tag of openingTags(template)) {
    for (const match of tag.attributes.matchAll(/(?:^|\s)(v-model(?:[:.][\w-]+)+)\s*=\s*(["'])(.*?)\2/g)) {
      add(tag.attributesStart + match.index!, match[0].length,
        'v-model arguments and modifiers are not compiled. Use :value and an explicit scope.set(...) handler.');
    }
    for (const match of tag.attributes.matchAll(/(?:^|\s)v-for\s*=\s*(["'])([A-Za-z_$][\w$]*)\s+(?:in|of)\b/g)) {
      if (reactiveNames.has(match[2])) {
        add(tag.attributesStart + match.index!, match[0].length,
          `v-for alias ${JSON.stringify(match[2])} shadows a Streamix binding; rename the alias.`);
      }
    }
    for (const match of tag.attributes.matchAll(/(?:^|\s)v-model\s*=\s*(["'])(.*?)\1/g)) {
      const expression = match[2].trim();
      const root = /^([A-Za-z_$][\w$]*)\s*(?:\.|\[)/.exec(expression)?.[1];
      if (!root || !reactiveNames.has(root)) continue;
      add(tag.attributesStart + match.index!, match[0].length,
        `v-model cannot mutate a member of Streamix binding ${JSON.stringify(root)}. ` +
        'Store the member in a scope, or use an explicit atom.next(...) handler.');
    }
  }
  return diagnostics;
}

/** Vue's setup auto-unwrapping cannot make derived values and flows writable. */
function readonlyTemplateDiagnostics(
  template: string,
  templateOffset: number,
  declarations: readonly ReactiveDeclaration[],
): readonly VueSfcDiagnostic[] {
  const readonlyNames = new Set(declarations.filter(item =>
    item.kind === 'derived' || item.kind === 'flow').map(item => item.name));
  const diagnostics: VueSfcDiagnostic[] = [];
  if (readonlyNames.size === 0) return diagnostics;

  for (const tag of openingTags(template)) {
    for (const model of tag.attributes.matchAll(/(?:^|\s)v-model\s*=\s*(["'])(.*?)\1/g)) {
      if (!readonlyNames.has(model[2].trim())) continue;
      diagnostics.push({ category: 'error', start: templateOffset + tag.attributesStart + model.index!,
        length: model[0].length, message: `v-model cannot write to read-only Streamix binding ${JSON.stringify(model[2].trim())}.` });
    }
  }
  for (const span of templateExpressionSpans(template)) {
    const expression = template.slice(span.start, span.end);
    const { file, prefix } = parseTemplateExpression(expression);
    const visit = (node: ts.Node): void => {
      let target: ts.Expression | undefined;
      if (ts.isBinaryExpression(node) && isAssignmentKind(node.operatorToken.kind)) target = node.left;
      else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) target = node.operand;
      if (target && ts.isIdentifier(target) && readonlyNames.has(target.text)) {
        diagnostics.push({ category: 'error', start: templateOffset + span.start + target.getStart(file) - prefix,
          length: target.text.length, message: `Cannot assign to read-only Streamix binding ${JSON.stringify(target.text)}.` });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return diagnostics;
}

/** Prevent a generated setup binding from colliding with an authored one. */
function generatedNameDiagnostics(
  script: string,
  scriptOffset: number,
  declarations: readonly ReactiveDeclaration[],
): readonly VueSfcDiagnostic[] {
  const file = ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true);
  const existing = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) existing.add(declaration.name.text);
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) existing.add(statement.name.text);
    if (ts.isClassDeclaration(statement) && statement.name) existing.add(statement.name.text);
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) existing.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) existing.add(bindings.name.text);
      else if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) existing.add(item.name.text);
      }
    }
  }
  const generated = declarations.filter(item => item.kind !== 'scope').map(item => reactiveBridgeName(item.name));
  for (const scope of declarations.filter(item => item.kind === 'scope')) {
    generated.push(...scope.members.map(member => bridgeName(scope.name, member)));
  }
  return [...new Set(generated)].filter(name => existing.has(name)).map(name => ({
    category: 'error' as const,
    message: `Generated Streamix Vue binding ${JSON.stringify(name)} collides with an existing setup declaration. Rename the authored declaration.`,
    start: scriptOffset,
    length: 0,
  }));
}

function bridgeName(scope: string, member: string): string {
  // Hex encoding is identifier-safe and preserves component boundaries, so
  // `a_b.c` cannot collide with `a.b_c`, and quoted keys remain valid.
  return `${BRIDGE_PREFIX}${encodeBridgePart(scope)}_${encodeBridgePart(member)}`;
}

function encodeBridgePart(value: string): string {
  return [...value].map(char => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
}

function reactiveBridgeName(name: string): string {
  return `${BRIDGE_PREFIX}${name}`;
}

function isBridged(
  bridgedScopes: Readonly<Record<string, readonly string[]>>,
  read: ScopeMemberRead,
): boolean {
  return (bridgedScopes[read.scope] ?? []).includes(read.member);
}

function usedMembers(usage: TemplateUsage, scopeName: string): string[] {
  const members = new Set<string>();

  for (const read of usage.reads) {
    if (read.scope === scopeName) members.add(read.member);
  }

  for (const write of usage.writes) {
    if (write.scope === scopeName) members.add(write.member);
  }

  return [...members].sort();
}

function insideAny(
  span: { start: number; end: number },
  ranges: readonly { start: number; end: number }[],
): boolean {
  return ranges.some(range => span.start >= range.start && span.end <= range.end);
}

function escapeSingleQuotes(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Applies non-overlapping edits right-to-left so earlier offsets stay valid. */
function applyEdits(source: string, edits: readonly SpanEdit[]): string {
  for (let index = 1; index < edits.length; index++) {
    const previous = edits[index - 1];
    const current = edits[index];
    if (current.end > previous.start) {
      throw new Error(`Streamix Vue compiler produced overlapping edits at ${current.start}.`);
    }
  }
  let result = source;

  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }

  return result;
}

function withRuntimeImport(source: string, installed: boolean): { insertion?: { offset: number; text: string } } {
  if (!installed) return {};

  // Read the *transformed* SFC descriptor rather than looking for a raw
  // closing-tag string. Existing imports may move after bridge insertion.
  const scriptSetup = parseSfc(source).descriptor.scriptSetup;
  if (!scriptSetup) return {};
  const script = ts.createSourceFile('script.ts', scriptSetup.content, ts.ScriptTarget.Latest, true);
  const imported = new Set<string>();
  for (const statement of script.statements) {
    if (!ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== '@epikodelabs/streamix/vue') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        // An aliased import doesn't provide the generated unaliased binding.
        if (!binding.propertyName) imported.add(binding.name.text);
      }
    }
  }
  // Generate only imports actually used by generated or authored calls. Importing
  // both bridges unconditionally fails strict `noUnusedLocals` builds.
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        BRIDGE_COMPOSABLES.has(node.expression.text)) {
      used.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(script);
  // Stable emission order, independent of where the calls appear in the script.
  const required = [...BRIDGE_COMPOSABLES].filter(name => used.has(name) && !imported.has(name));
  if (required.length === 0) return {};
  const statement = `\nimport { ${required.join(', ')} } from "@epikodelabs/streamix/vue";\n`;
  // TypeScript only honors `@ts-check` / `@ts-nocheck` within leading
  // comments, so the generated import goes after such a pragma instead of
  // at the very top of the script setup.
  const pragma = /^\s*(?:\/\/[^\n]*\n)*\s*\/\/[^\n]*@ts-(?:no)?check\b[^\n]*\n/.exec(scriptSetup.content);
  return { insertion: { offset: scriptSetup.loc.start.offset + (pragma?.[0].length ?? 0), text: statement } };
}

function factoryImports(script: string): FactoryImports {
  const aliases = new Map<string, FactoryKind>();
  const file = ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const isStreamix = STREAMIX_MODULE.test(statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        const imported = (item.propertyName ?? item.name).text;

        if (isStreamix && FACTORY_NAMES.has(imported as FactoryKind)) {
          aliases.set(item.name.text, imported as FactoryKind);
        }
      }
    }
  }

  return { aliases };
}

function collectReactiveDeclarations(
  script: string,
  imports: FactoryImports,
): ReactiveDeclaration[] {
  const declarations: ReactiveDeclaration[] = [];
  const file = ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !declaration.initializer ||
        !ts.isCallExpression(declaration.initializer) ||
        !ts.isIdentifier(declaration.initializer.expression)
      ) {
        continue;
      }

      const callee = declaration.initializer.expression.text;
      const aliased = imports.aliases.get(callee);
      // Adopt only an explicit Streamix import. A same-named local helper is
      // ordinary application code and must never be silently transformed.
      const kind = aliased;

      if (!kind || !FACTORY_NAMES.has(kind)) continue;

      declarations.push({
        name: declaration.name.text,
        kind,
        callExpressionStart: declaration.initializer.expression.getStart(file),
        callEnd: declaration.initializer.end,
        statementEnd: statement.end,
        ...(kind === 'derived' ? derivedCallbackSpan(declaration.initializer, file) : {}),
        members: kind === 'scope' ? scopeMemberNames(declaration.initializer) : [],
      });
    }
  }

  return declarations;
}

function derivedCallbackSpan(
  call: ts.CallExpression,
  file: ts.SourceFile,
): Pick<ReactiveDeclaration, 'derivedCallbackStart' | 'derivedCallbackEnd'> {
  const callback = call.arguments[0];

  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return {};
  }

  return {
    derivedCallbackStart: callback.getStart(file),
    derivedCallbackEnd: callback.end,
  };
}

interface TemplateReactiveRead {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  /** Object shorthand needs to retain the authored object key. */
  readonly replacement?: string;
}

/** Finds bare reactive identifiers in template expressions, excluding scope paths. */
function collectTemplateReactiveReads(
  template: string,
  declarations: readonly ReactiveDeclaration[],
): readonly TemplateReactiveRead[] {
  const names = new Set(declarations.map(declaration => declaration.name));
  const reads: TemplateReactiveRead[] = [];

  for (const span of templateExpressionSpans(template)) {
    const expression = template.slice(span.start, span.end);
    // Wrapping produces a normal expression source file and prevents strings,
    // comments, and object keys from being mistaken for reactive identifiers.
    const { file, prefix } = parseTemplateExpression(expression);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && names.has(node.text) && isValueIdentifier(node)) {
          const start = span.start + node.getStart(file) - prefix;
          const shorthand = ts.isShorthandPropertyAssignment(node.parent);
          reads.push({
            start,
            end: start + node.text.length,
            name: node.text,
            replacement: shorthand ? `${node.text}: ${reactiveBridgeName(node.text)}` : undefined,
          });
          return;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  for (const tag of openingTags(template)) {
    for (const match of tag.attributes.matchAll(/(?:^|\s)v-model\s*=\s*(["'])([A-Za-z_$][\w$]*)\1/g)) {
      const name = match[2];
      if (!names.has(name)) continue;
      const start = tag.attributesStart + match.index! + match[0].lastIndexOf(name);
      reads.push({ start, end: start + name.length, name });
    }
  }

  return reads;
}

/**
 * Lowers arithmetic-style derived shorthand to raw atom value reads. The raw
 * atom identifiers remain in scope; generated Vue refs are never captured by
 * the derived callback.
 */
function derivedAtomValueReadEdits(
  script: string,
  declarations: readonly ReactiveDeclaration[],
): readonly SpanEdit[] {
  const atoms = new Set(declarations.filter(item => item.kind === 'atom').map(item => item.name));
  if (atoms.size === 0) return [];
  const file = ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true);
  const edits: SpanEdit[] = [];
  const bodies = declarations.filter(item => item.kind === 'derived' &&
    item.derivedCallbackStart !== undefined && item.derivedCallbackEnd !== undefined);

  for (const derived of bodies) {
    const callback = findNodeAt(file, derived.derivedCallbackStart!, derived.derivedCallbackEnd!);
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) continue;
    const body = callback.body;
    const hasTrackerParameter = callback.parameters.some(parameter => containsBinding(parameter.name, '$'));
    const visit = (node: ts.Node): void => {
      // `$` receives atom references and registers them as dependencies. Its
      // arguments must not be lowered to `.value` reads.
      if (hasTrackerParameter && ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) && node.expression.text === '$') return;
      if (ts.isIdentifier(node) && atoms.has(node.text) &&
          isValueIdentifier(node) && !isShadowedIn(node, callback, node.text)) {
        const start = node.getStart(file);
        const shorthand = ts.isShorthandPropertyAssignment(node.parent);
        edits.push({ start, end: node.end,
          replacement: shorthand ? `${node.text}: ${node.text}.value` : `${node.text}.value` });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return edits;
}

/** Locate a callback body by its source span; its TS nodes retain original offsets. */
function findNodeAt(root: ts.Node, start: number, end: number): ts.Node | undefined {
  if (root.getStart() === start && root.end === end) return root;
  let found: ts.Node | undefined;
  ts.forEachChild(root, node => {
    if (!found && node.getStart() <= start && node.end >= end) {
      found = findNodeAt(node, start, end);
    }
  });
  return found;
}

/** Only value references are rewritten, never types, declarations or keys. */
function isValueIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'value') return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (ts.isImportSpecifier(parent) || ts.isTypeReferenceNode(parent) ||
      ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) ||
      ts.isLabeledStatement(parent)) return false;
  return true;
}

function containsBinding(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text;
  return name.elements.some(element => ts.isBindingElement(element) && containsBinding(element.name, text));
}

/** Reject local declarations that shadow a top-level atom inside a callback. */
function isShadowedIn(node: ts.Node, body: ts.Node, name: string): boolean {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters?.some(param => containsBinding(param.name, name))) return true;
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      if (scope.statements.some(statement =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl => containsBinding(decl.name, name)) ||
        ts.isFunctionDeclaration(statement) && statement.name?.text === name ||
        ts.isClassDeclaration(statement) && statement.name?.text === name)) return true;
    }
    if (scope === body) break;
  }
  return false;
}

function scopeMemberNames(call: ts.CallExpression): string[] {
  const argument = call.arguments[0];

  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return [];
  }

  const names: string[] = [];

  for (const property of argument.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      names.push(property.name.text);
    }
  }

  return names;
}

function collectTemplateUsage(
  template: string,
  declarations: readonly ReactiveDeclaration[],
): TemplateUsage {
  const scopeNames = new Set(declarations.filter(item => item.kind === 'scope').map(item => item.name));
  const reactiveNames = new Set(declarations.filter(item => item.kind !== 'scope').map(item => item.name));
  const reads: ScopeMemberRead[] = [];
  const writes: ScopeMemberWrite[] = [];

  for (const span of templateExpressionSpans(template)) {
    const expression = template.slice(span.start, span.end);
    const { file, prefix } = parseTemplateExpression(expression);
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression) &&
          scopeNames.has(node.left.expression.text)) {
        const target = node.left;
        const rhs = expression.slice(node.right.getStart(file) - prefix, node.right.end - prefix);
        const rewritten = rewriteReactiveReadsInText(
          rewriteReadsInText(rhs, scopeNames, reads, span.start + node.right.getStart(file) - prefix),
          reactiveNames,
        );
        writes.push({
          start: span.start + node.getStart(file) - prefix,
          end: span.start + node.end - prefix,
          scope: (target.expression as ts.Identifier).text,
          member: target.name.text,
          rhs: rewritten,
        });
        // Nested assignments require explicit sequencing, not overlapping edits.
        return;
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
          scopeNames.has(node.expression.text)) {
        reads.push({
          start: span.start + node.getStart(file) - prefix,
          end: span.start + node.end - prefix,
          scope: node.expression.text, member: node.name.text,
        });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { reads, writes };
}

/** Script events can contain statements; most directive values are expressions. */
function parseTemplateExpression(expression: string): { file: ts.SourceFile; prefix: number } {
  const statements = /;/.test(expression);
  const prefix = statements ? 0 : 1;
  return {
    file: ts.createSourceFile('template-expression.ts', statements ? expression : `(${expression})`,
      ts.ScriptTarget.Latest, true),
    prefix,
  };
}

/** Rewrites raw atom/derived/flow reads inside a replacement expression. */
function rewriteReactiveReadsInText(fragment: string, reactiveNames: ReadonlySet<string>): string {
  if (reactiveNames.size === 0) return fragment;
  const { file, prefix } = parseTemplateExpression(fragment);
  const edits: SpanEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && reactiveNames.has(node.text) && isValueIdentifier(node)) {
      const shorthand = ts.isShorthandPropertyAssignment(node.parent);
      edits.push({ start: node.getStart(file) - prefix, end: node.end - prefix,
        replacement: shorthand ? `${node.text}: ${reactiveBridgeName(node.text)}` : reactiveBridgeName(node.text) });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (edits.length === 0) return fragment;
  return applyEdits(fragment, edits.sort((left, right) => right.start - left.start));
}

/** Rewrites scope-member reads inside a right-hand-side fragment. */
function rewriteReadsInText(
  fragment: string,
  scopeNames: ReadonlySet<string>,
  reads: ScopeMemberRead[],
  absoluteStart: number,
): string {
  const { file, prefix } = parseTemplateExpression(fragment);
  const edits: SpanEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
        scopeNames.has(node.expression.text)) {
      const start = node.getStart(file) - prefix;
      const end = node.end - prefix;
      reads.push({ start: absoluteStart + start, end: absoluteStart + end,
        scope: node.expression.text, member: node.name.text });
      edits.push({ start, end, replacement: bridgeName(node.expression.text, node.name.text) });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return applyEdits(fragment, edits.sort((a, b) => b.start - a.start));
}

interface VModelScopeBinding {
  readonly element: string;
  readonly attributes: string;
  readonly scope: string;
  readonly member: string;
  readonly start: number;
  readonly end: number;
}

function collectVModelScopeBindings(
  template: string,
  declarations: readonly ReactiveDeclaration[],
): readonly VModelScopeBinding[] {
  const scopeNames = new Set(declarations.filter(item => item.kind === 'scope').map(item => item.name));
  const bindings: VModelScopeBinding[] = [];

  for (const tag of openingTags(template)) {
    for (const model of tag.attributes.matchAll(/(?:^|\s)(v-model)\s*=\s*(["'])(.*?)\2/g)) {
      const path = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(model[3].trim());
      if (!path || !scopeNames.has(path[1])) continue;
      const start = tag.attributesStart + model.index! + model[0].indexOf('v-model');
      bindings.push({ element: tag.name, attributes: tag.attributes, scope: path[1],
        member: path[2], start, end: start + model[0].trimStart().length });
    }
  }
  return bindings;
}

/** Find opening tags without confusing `>` inside quoted attribute values for tag ends. */
function openingTags(template: string): { name: string; attributes: string; attributesStart: number }[] {
  const result: { name: string; attributes: string; attributesStart: number }[] = [];
  for (let offset = 0; offset < template.length;) {
    const open = template.indexOf('<', offset);
    if (open < 0) break;
    if (template.startsWith('<!--', open)) {
      const close = template.indexOf('-->', open + 4);
      offset = close < 0 ? template.length : close + 3;
      continue;
    }
    const tag = /^<([A-Za-z][\w-]*)/.exec(template.slice(open));
    if (!tag) { offset = open + 1; continue; }
    const attributesStart = open + tag[0].length;
    let quote: string | undefined;
    let end = attributesStart;
    for (; end < template.length; end++) {
      const char = template[end];
      if (quote) { if (char === quote) quote = undefined; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    result.push({ name: tag[1].toLowerCase(),
      attributes: template.slice(attributesStart, end), attributesStart });
    offset = end + 1;
  }
  return result;
}

interface TemplateExpressionSpan {
  /** Absolute offset in the template string. */
  readonly start: number;
  readonly end: number;
}

/**
 * Expression positions Vue evaluates: interpolation contents and bound
 * directive/attribute values (including event handlers). Static attributes
 * and prose are never returned.
 */
function templateExpressionSpans(template: string): TemplateExpressionSpan[] {
  const spans: TemplateExpressionSpan[] = [];

  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    spans.push({
      start: match.index! + 2,
      end: match.index! + match[0].length - 2,
    });
  }

  for (const match of template.matchAll(
    /(?:[:@#][\w.:[\]-]+|v-(?:if|else-if|for|show|text|html)(?:\.[\w-]+)?|v-(?:bind|on)(?::[\w.:[\]-]+)?)\s*=\s*(["'])([\s\S]*?)\1/g,
  )) {
    const valueStart = match.index! + match[0].length - match[2].length - 1;
    spans.push({ start: valueStart, end: valueStart + match[2].length });
  }

  return spans;
}
