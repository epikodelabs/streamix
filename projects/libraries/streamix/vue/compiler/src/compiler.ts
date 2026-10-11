import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';

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
  /** Number of adopted reactive declarations plus bridged scope members. */
  readonly bindingCount: number;
  /** Scope members the compiler bridged, keyed by scope name. */
  readonly bridgedScopes: Readonly<Record<string, readonly string[]>>;
  /** Diagnostics for syntax the compiler refuses to rewrite. */
  readonly diagnostics: readonly VueSfcDiagnostic[];
}

/** Formats transform diagnostics with a source location and one-line frame. */
export function formatVueSfcDiagnostics(
  source: string,
  fileName: string,
  diagnostics: readonly VueSfcDiagnostic[],
): string {
  const lines = source.split(/\r?\n/);

  return diagnostics.map(diagnostic => {
    if (diagnostic.start < 0) {
      return `${fileName} - ${diagnostic.category}: ${diagnostic.message}`;
    }

    let offset = 0;
    let lineIndex = 0;
    while (lineIndex < lines.length && offset + lines[lineIndex].length + 1 <= diagnostic.start) {
      offset += lines[lineIndex].length + 1;
      lineIndex++;
    }
    const column = diagnostic.start - offset;
    const line = lines[lineIndex] ?? '';
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
  readonly derivedBodyStart?: number;
  readonly derivedBodyEnd?: number;
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
 * deriveds and flows become `useIterable`, and every scope member the
 * template touches is bridged as its own read-only ref with member writes and
 * `v-model` lowered to `scope.set(...)`. Vue's native setup auto-unwrap then
 * makes templates read and write the atoms as ordinary state — no manual
 * composable calls and no copies of Streamix state into Vue stores.
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

  for (const scope of scopes) {
    const used = usedMembers(usage, scope.name);
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

  const code = applyEdits(source, templateAndScriptEdits);
  const bindingCount =
    reactive.length + Object.values(bridgedScopes).flat().length;

  return {
    code: withRuntimeImport(code, scriptOffset, templateAndScriptEdits.length > 0),
    bindingCount,
    bridgedScopes,
    diagnostics,
  };
}

/** Reject shapes the compiler cannot lower without changing Vue semantics. */
function unsupportedTemplateDiagnostics(
  template: string,
  templateOffset: number,
  declarations: readonly ReactiveDeclaration[],
): readonly VueSfcDiagnostic[] {
  const scopes = declarations.filter(item => item.kind === 'scope').map(item => item.name);
  const diagnostics: VueSfcDiagnostic[] = [];
  const add = (match: RegExpExecArray, message: string): void => {
    diagnostics.push({
      category: 'error', message, start: templateOffset + match.index, length: match[0].length,
    });
  };
  for (const scope of scopes) {
    const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of template.matchAll(new RegExp(`\\b${escaped}(?:\\?\\.|\\[)`, 'g'))) {
      add(match, `Unsupported dynamic scope access on ${scope}. Use scope.get(...) in script and bind the returned ref.`);
    }
    for (const match of template.matchAll(new RegExp(`\\b${escaped}\\.[A-Za-z_$][\\w$]*\\s*(?:\\+\\+|--|[+*/%&|^]?=)`, 'g'))) {
      add(match, `Unsupported compound scope write on ${scope}. Use an explicit scope.set(...) handler.`);
    }
  }
  for (const match of template.matchAll(/\bv-model(?:[:.]\S+)?\s*=\s*(["'])[^"']*\1/g)) {
    if (match[0].startsWith('v-model=')) continue;
    add(match, 'v-model arguments and modifiers are not compiled. Use :value and an explicit scope.set(...) handler.');
  }
  const reactiveNames = new Set(declarations.filter(item => item.kind !== 'scope').map(item => item.name));
  for (const match of template.matchAll(/v-for\s*=\s*(["'])([A-Za-z_$][\w$]*)\s+(?:in|of)\b/g)) {
    if (reactiveNames.has(match[2])) {
      add(match, `v-for alias ${JSON.stringify(match[2])} shadows a Streamix binding; rename the alias.`);
    }
  }
  return diagnostics;
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

function withRuntimeImport(
  source: string,
  scriptOffset: number,
  installed: boolean,
): string {
  if (!installed) {
    return source;
  }

  const script = source.slice(scriptOffset, source.indexOf('</script>', scriptOffset));
  const imported = new Set<string>();
  for (const match of script.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@epikodelabs\/streamix\/vue["']/g)) {
    for (const name of match[1].split(',')) imported.add(name.trim().split(/\s+as\s+/)[0]);
  }
  const required = ['useIterable', 'useWritable'].filter(name => !imported.has(name));
  if (required.length === 0) return source;
  const statement = `import { ${required.join(', ')} } from "@epikodelabs/streamix/vue";\n`;
  // `scriptSetup.loc.start.offset` is the content start and remains correct
  // even when the opening tag contains a generic attribute with `>`.
  const contentStart = scriptOffset;
  // The generated import is the first line inside <script setup>, so the
  // transformed file stays readable and the import stays hoisted.
  return source.slice(0, contentStart) + `\n` + statement + source.slice(contentStart);
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
): Pick<ReactiveDeclaration, 'derivedBodyStart' | 'derivedBodyEnd'> {
  const callback = call.arguments[0];

  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return {};
  }

  return {
    derivedBodyStart: callback.body.getStart(file),
    derivedBodyEnd: callback.body.end,
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
    const file = ts.createSourceFile('template-expression.ts', `(${expression})`, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && names.has(node.text)) {
        const property = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
        const explicitValue = ts.isPropertyAccessExpression(node.parent) &&
          node.parent.expression === node && node.parent.name.text === 'value';
        if (!property && !explicitValue) {
          const start = span.start + node.getStart(file) - 1;
          const shorthand = ts.isShorthandPropertyAssignment(node.parent);
          reads.push({
            start,
            end: start + node.text.length,
            name: node.text,
            replacement: shorthand ? `${node.text}: ${reactiveBridgeName(node.text)}` : undefined,
          });
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  for (const match of template.matchAll(/\bv-model="([A-Za-z_$][\w$]*)"/g)) {
    const name = match[1];
    if (!names.has(name)) continue;
    const start = match.index! + match[0].indexOf(name);
    reads.push({ start, end: start + name.length, name });
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
  const atomNames = new Set(
    declarations
      .filter(declaration => declaration.kind === 'atom')
      .map(declaration => declaration.name),
  );
  const edits: SpanEdit[] = [];

  for (const declaration of declarations) {
    if (
      declaration.kind !== 'derived' ||
      declaration.derivedBodyStart === undefined ||
      declaration.derivedBodyEnd === undefined
    ) {
      continue;
    }

    const body = script.slice(declaration.derivedBodyStart, declaration.derivedBodyEnd);
    for (const match of body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const name = match[1];
      if (!atomNames.has(name)) continue;

      const start = declaration.derivedBodyStart + match.index!;
      const before = script[start - 1];
      const after = script[start + name.length];
      if (before === '.' || after === '.') continue;
      edits.push({ start, end: start + name.length, replacement: `${name}.value` });
    }
  }

  return edits;
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
  const scopeNames = new Set(
    declarations.filter(declaration => declaration.kind === 'scope').map(declaration => declaration.name),
  );
  const reactiveNames = new Set(
    declarations.filter(declaration => declaration.kind !== 'scope').map(declaration => declaration.name),
  );
  const reads: ScopeMemberRead[] = [];
  const writes: ScopeMemberWrite[] = [];

  for (const span of templateExpressionSpans(template)) {
    const expression = template.slice(span.start, span.end);

    // Whole `scope.member = rhs` assignments (event handlers) lower to
    // `scope.set(member, rhs)`. The right-hand side is kept verbatim here and
    // its own scope reads are rewritten in place below.
    const assignment =
      /(^|[^\w$.])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]*?\S)\s*$/.exec(expression);

    if (assignment && scopeNames.has(assignment[2])) {
      const contentStart = span.start + assignment.index! + assignment[1].length;
      writes.push({
        start: contentStart,
        end: span.end,
        scope: assignment[2],
        member: assignment[3],
        rhs: rewriteReactiveReadsInText(rewriteReadsInText(
          assignment[4],
          expression.indexOf(assignment[4]),
          scopeNames,
          reads,
          span.start,
        ), reactiveNames),
      });
    }

    // Every remaining `scope.member` path is a read candidate.
    for (const match of expression.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
      if (!scopeNames.has(match[1])) continue;

      const start = span.start + match.index!;
      const end = start + match[0].length;

      // Skip the assignment target itself: its write edit replaces the whole
      // assignment, including this span.
      if (writes.some(write => start >= write.start && end <= write.end)) {
        continue;
      }

      reads.push({ start, end, scope: match[1], member: match[2] });
    }
  }

  return { reads, writes };
}

/** Rewrites raw atom/derived/flow reads inside a replacement expression. */
function rewriteReactiveReadsInText(fragment: string, reactiveNames: ReadonlySet<string>): string {
  if (reactiveNames.size === 0) return fragment;
  const file = ts.createSourceFile('template-expression.ts', `(${fragment})`, ts.ScriptTarget.Latest, true);
  const edits: SpanEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && reactiveNames.has(node.text)) {
      const property = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const explicitValue = ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node && node.parent.name.text === 'value';
      if (!property && !explicitValue) {
        edits.push({ start: node.getStart(file) - 1, end: node.end - 1, replacement: reactiveBridgeName(node.text) });
        return;
      }
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
  offsetInSpan: number,
  scopeNames: Set<string>,
  reads: ScopeMemberRead[],
  spanStart: number,
): string {
  let result = '';
  let cursor = 0;

  for (const match of fragment.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
    if (!scopeNames.has(match[1])) continue;

    const start = match.index!;
    const end = start + match[0].length;

    result += fragment.slice(cursor, start);
    result += BRIDGE_PREFIX + match[1] + '_' + match[2];
    cursor = end;

    reads.push({
      start: spanStart + offsetInSpan + start,
      end: spanStart + offsetInSpan + end,
      scope: match[1],
      member: match[2],
    });
  }

  return result + fragment.slice(cursor);
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
  const scopeNames = new Set(
    declarations.filter(declaration => declaration.kind === 'scope').map(declaration => declaration.name),
  );
  const bindings: VModelScopeBinding[] = [];

  for (const match of template.matchAll(/<([\w-]+)([^>]*?)\sv-model="([^"]*)"/g)) {
    const expression = match[3];
    const path = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(expression.trim());

    if (!path || !scopeNames.has(path[1])) {
      continue;
    }

    // Offset of the v-model attribute within the whole template, taken from
    // this element's own match rather than a text search that could land on
    // an identical earlier attribute.
    const attribute = `v-model="${expression}"`;
    const attributeStart = match.index! + match[0].indexOf(attribute);
    bindings.push({
      element: match[1],
      attributes: match[2],
      scope: path[1],
      member: path[2],
      start: attributeStart,
      end: attributeStart + attribute.length,
    });
  }

  return bindings;
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
    /(?:[:@#][\w.:[\]-]+|v-(?:if|else-if|for|show)(?:\.[\w-]+)?|v-(?:bind|on)(?::[\w.:[\]-]+)?)\s*=\s*(["'])([\s\S]*?)\1/g,
  )) {
    const valueStart = match.index! + match[0].length - match[2].length - 1;
    spans.push({ start: valueStart, end: valueStart + match[2].length });
  }

  return spans;
}
