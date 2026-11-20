import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { applyMappedEdits, insertMappedText, createVueSourceMap, type VueSourceMap } from './source-map';
import { hoistedVarDeclarations } from '@epikodelabs/streamix/compiler';

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
  /** Local names for Streamix's `method(...)` scope-member helper. */
  methodAliases: Set<string>;
}

type FactoryKind = 'atom' | 'derived' | 'flow' | 'scope';

/**
 * How a `scope({...})` member behaves at runtime. The compiler must not pass
 * a nested scope or a `method(...)` member to a source bridge: both are
 * callable, and the `useIterable` factory overload would invoke them.
 */
type ScopeMemberKind = 'source' | 'nested' | 'method';

interface ScopeMemberDeclaration {
  readonly name: string;
  readonly kind: ScopeMemberKind;
  /** Members of a nested scope, when its literal is statically available. */
  readonly members: readonly ScopeMemberDeclaration[];
  /** A nested scope built by a factory the compiler cannot inspect. */
  readonly opaque?: boolean;
}

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
  /** Classified scope members, for scope declarations. */
  readonly members: readonly ScopeMemberDeclaration[];
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
  /** Dotted member path below the scope, for example `profile.name`. */
  readonly path: readonly string[];
}

interface ScopeMemberWrite {
  readonly start: number;
  readonly end: number;
  readonly scope: string;
  readonly path: readonly string[];
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
const BRIDGE_COMPOSABLES = new Set(['useIterable', 'useScope', 'useScopeMember', 'useWritable']);

/** v-model element/prop mapping, mirroring the Angular two-way allow-list. */
const V_MODEL_NATIVE: Readonly<Record<string, { prop: string; event: string; value: string }>> = {
  input: { prop: 'value', event: 'input', value: '$event.target.value' },
  textarea: { prop: 'value', event: 'input', value: '$event.target.value' },
  select: { prop: 'value', event: 'change', value: '$event.target.value' },
};

/**
 * Reads one static (unbound) attribute from an opening tag's attribute
 * source. Bound (`:type`), namespaced (`data-type`), and directive attributes
 * never match, so they cannot spoof native attribute checks.
 */
function attributeTokens(attributes: string): IterableIterator<RegExpMatchArray> {
  return attributes.matchAll(/(?:^|\s)([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g);
}

function* matchAttributes(attributes: string, pattern: RegExp): IterableIterator<RegExpMatchArray> {
  for (const token of attributeTokens(attributes)) {
    const match = token[0].matchAll(pattern).next().value;
    if (match) {
      match.index = token.index! + match.index!;
      yield match;
    }
  }
}

function staticAttributeValue(attributes: string, name: string): string | undefined {
  for (const match of attributeTokens(attributes)) {
    if (match[1].toLowerCase() === name) {
      return match[2] ?? match[3] ?? match[4] ?? '';
    }
  }
  return undefined;
}

function hasStaticAttribute(attributes: string, name: string): boolean {
  for (const match of attributeTokens(attributes)) {
    if (match[1].toLowerCase() === name) return true;
  }
  return false;
}

/**
 * Compiles a Vue single-file component that declares raw Streamix atoms,
 * deriveds, flows, and scopes in `<script setup>`.
 *
 * Raw declarations are rewritten onto the Vue bridge composables: writable
 * atoms become `useWritable` (reads track; template assignments and
 * `v-model` emit through the computed setter via Vue's setup-binding proxy),
 * deriveds and flows become `useIterable`, and each scope itself is wrapped in
 * `useScope(...)` so its lifetime is tied to the component.
 *
 * Scope members are classified from the `scope({...})` literal before a
 * bridge is chosen: atom/readable leaves (including leaves of nested scopes)
 * become `useScopeMember` bridges with member writes and `v-model` lowered to
 * `scope.set(...)`, while `method(...)` members are callables and stay
 * authored calls. Vue's native setup auto-unwrap then makes templates read
 * and write the atoms as ordinary state — no manual composable calls and no
 * copies of Streamix state into Vue stores.
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
      diagnostics: parsed.errors.map(error => {
        // Template compiler errors carry a source location; plain syntax
        // errors do not.
        const loc = (error as {
          loc?: { start: { offset: number }; end: { offset: number } };
        }).loc;
        return {
          category: 'error' as const,
          message: error.message ?? String(error),
          start: loc?.start.offset ?? -1,
          length: loc ? Math.max(0, loc.end.offset - loc.start.offset) : 0,
        };
      }),
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
  const formulaEdits = derivedAtomValueReadEdits(scriptContent, declarations, imports, scriptOffset, diagnostics);

  if (declarations.length === 0 && formulaEdits.length === 0) {
    return { code: source, bindingCount: 0, bridgedScopes: {}, diagnostics };
  }

  const localScopes = collectTemplateLocalScopes(
    (descriptor.template as { ast?: TemplateAstNode }).ast,
    templateOffset,
  );
  const localsAt: TemplateLocalsAt = (offset: number) => templateLocalsAt(localScopes, offset);

  diagnostics.push(...unsupportedTemplateDiagnostics(templateContent, templateOffset, declarations, localsAt));
  diagnostics.push(...readonlyTemplateDiagnostics(templateContent, templateOffset, declarations, localsAt));
  diagnostics.push(...generatedNameDiagnostics(scriptContent, scriptOffset, declarations));

  const templateUsage = collectTemplateUsage(templateContent, declarations, localsAt);
  const vModelBindings = collectVModelScopeBindings(templateContent, declarations, localsAt);
  const usage: TemplateUsage = {
    reads: [
      ...templateUsage.reads,
      // v-model owns its whole attribute span below. Adding it here would
      // create a second, overlapping replacement.
    ],
    writes: templateUsage.writes,
  };
  const scopes = declarations.filter(
    (declaration): declaration is ReactiveDeclaration & { kind: 'scope' } =>
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
    // useWritable's second parameter is the diagnostic name; useIterable's
    // second parameter is initialValue, so the diagnostic name moves third.
    const bridge = declaration.kind === 'atom'
      ? `useWritable(${declaration.name}, '${declaration.name}')`
      : `useIterable(${declaration.name}, undefined, '${declaration.name}')`;

    scriptEdits.push({
      start: declaration.statementEnd,
      end: declaration.statementEnd,
      replacement: `\nconst ${reactiveBridgeName(declaration.name)} = ${bridge};`,
    });
  }

  for (const edit of formulaEdits) {
    scriptEdits.push(edit);
  }

  const writeSpans = templateUsage.writes.map(write => ({ start: write.start, end: write.end }));
  for (const read of collectTemplateReactiveReads(templateContent, reactive, localsAt)) {
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

  // Vue 3.4 same-name bindings carry no value text; expand them so the
  // authored prop name stays while the expression reads the bridge.
  for (const edit of sameNameBindingEdits(templateContent, declarations, localsAt)) {
    templateEdits.push(edit);
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

  const scopeByName = new Map(scopes.map(scope => [scope.name, scope]));
  const scopeLabel = (scopeName: string, path: readonly string[]): string =>
    `${scopeName}.${path.join('.')}`;

  // First occurrence of each used member path, so diagnostics point at the
  // offending expression instead of the whole template block.
  const pathSpans = new Map<string, { start: number; end: number }>();
  const rememberPathSpan = (
    scopeName: string,
    path: readonly string[],
    span: { start: number; end: number },
  ): void => {
    const key = `${scopeName}.${path.join('.')}`;
    if (!pathSpans.has(key)) pathSpans.set(key, span);
  };
  for (const read of usage.reads) rememberPathSpan(read.scope, read.path, read);
  for (const write of usage.writes) rememberPathSpan(write.scope, write.path, write);
  for (const model of vModelBindings) {
    rememberPathSpan(model.scope, model.path, { start: model.start, end: model.end });
  }

  const scopeDiagnostic = (
    message: string,
    scopeName?: string,
    path?: readonly string[],
  ): void => {
    const span = scopeName && path
      ? pathSpans.get(`${scopeName}.${path.join('.')}`)
      : undefined;
    diagnostics.push({
      category: 'error',
      message,
      start: span ? templateOffset + span.start : templateOffset,
      length: span ? span.end - span.start : templateContent.length,
    });
  };

  // Every distinct member path the template reaches, including paths inside
  // assignment right-hand sides. Members are classified before the compiler
  // chooses a bridge: methods and nested scopes are callable, never sources.
  const usedPaths = new Map<string, Set<string>>();
  const addUsedPath = (scopeName: string, path: readonly string[]): void => {
    let paths = usedPaths.get(scopeName);
    if (!paths) {
      paths = new Set();
      usedPaths.set(scopeName, paths);
    }
    paths.add(path.join('.'));
  };
  for (const read of usage.reads) addUsedPath(read.scope, read.path);
  for (const write of usage.writes) addUsedPath(write.scope, write.path);
  for (const model of vModelBindings) addUsedPath(model.scope, model.path);

  const bridgedPaths = new Map<string, Set<string>>();
  for (const [scopeName, paths] of usedPaths) {
    const scope = scopeByName.get(scopeName);
    if (!scope) continue;

    const accepted = new Set<string>();
    bridgedPaths.set(scopeName, accepted);

    for (const dotted of [...paths].sort()) {
      const path = dotted.split('.');
      const resolution = resolveScopePath(scope.members, path);

      if (resolution.kind === 'missing') {
        scopeDiagnostic(
          `Scope member ${JSON.stringify(scopeLabel(scopeName, path))} is not declared by the scope literal, ` +
          'so the compiler cannot bridge it.',
          scopeName,
          path,
        );
        continue;
      }

      if (resolution.kind === 'opaque') {
        scopeDiagnostic(
          `Scope member ${JSON.stringify(scopeLabel(scopeName, path))} crosses a nested scope the compiler ` +
          'cannot inspect. Use scope.get(...) in script and bridge the atom explicitly.',
          scopeName,
          path,
        );
        continue;
      }

      if (resolution.kind !== 'source') continue;

      // A source value may be followed by ordinary property reads
      // (`state.rows.length`); bridge the source prefix only.
      accepted.add(path.slice(0, resolution.depth).join('.'));
    }
  }

  for (const [scopeName, paths] of bridgedPaths) {
    const scope = scopeByName.get(scopeName);
    if (!scope) continue;

    const accepted = [...paths].sort();
    for (const dotted of accepted) {
      const segments = dotted.split('.');
      scriptEdits.push({
        // Insert after the declaration statement, not inside the initializer.
        // This keeps multi-declarator statements syntactically valid.
        start: scope.statementEnd,
        end: scope.statementEnd,
        replacement:
          `\nconst ${bridgeName(scopeName, segments)} = useScopeMember(` +
          `${scopePathAccess(scopeName, segments)}, '${scopeLabel(scopeName, segments)}');`,
      });
    }

    // Only scopes the template actually reached are reported; an adopted but
    // untouched scope stays out of the bridge table (an unknown-member report
    // still records the key with an empty member list).
    if ((usedPaths.get(scopeName)?.size ?? 0) > 0) {
      bridgedScopes[scopeName] = accepted;
    }
  }

  // Scope-member reads rewrite to the bridged refs; Vue auto-unwraps
  // top-level setup refs, so the template expression text stays natural.
  const scopeWriteSpans = usage.writes.map(write => ({ start: write.start, end: write.end }));

  for (const read of usage.reads) {
    if (insideAny(read, scopeWriteSpans)) {
      continue;
    }

    const scope = scopeByName.get(read.scope);
    if (!scope) continue;

    const resolution = resolveScopePath(scope.members, read.path);
    if (resolution.kind !== 'source') continue;

    const prefix = read.path.slice(0, resolution.depth);
    const rest = read.path.slice(resolution.depth);
    const bridge = bridgeName(read.scope, prefix);
    templateEdits.push({
      start: read.start,
      end: read.end,
      replacement: rest.length === 0 ? bridge : `${bridge}.${rest.join('.')}`,
    });
  }

  // Whole `scope.member = rhs` assignments lower to `scope.set(member, rhs)`;
  // nested members lower through their parent scope. Reactive reads inside the
  // right-hand side are rewritten in place first so the replacement does not
  // depend on edit ordering.
  for (const write of usage.writes) {
    const scope = scopeByName.get(write.scope);
    if (!scope) continue;

    const resolution = resolveScopePath(scope.members, write.path);
    if (resolution.kind === 'missing' || resolution.kind === 'opaque') {
      // Reported once by the usage pass above.
      continue;
    }

    if (resolution.kind === 'method') {
      scopeDiagnostic(
        `Cannot assign to method member ${JSON.stringify(scopeLabel(write.scope, write.path))}. ` +
        'Mutate scope state inside the method instead.',
        write.scope,
        write.path,
      );
      continue;
    }

    if (resolution.kind === 'nested') {
      scopeDiagnostic(
        `Cannot assign to nested scope ${JSON.stringify(scopeLabel(write.scope, write.path))}. ` +
        'Assign one of its atom members instead.',
        write.scope,
        write.path,
      );
      continue;
    }

    if (resolution.depth !== write.path.length) {
      scopeDiagnostic(
        `Cannot assign through ${JSON.stringify(scopeLabel(write.scope, write.path.slice(0, resolution.depth)))}: ` +
        'it is an atom holding an object, so the assignment would not emit. Replace the whole value with scope.set(...) instead.',
        write.scope,
        write.path,
      );
      continue;
    }

    templateEdits.push({
      start: write.start,
      end: write.end,
      replacement: `${scopeSetCall(write.scope, write.path)}${write.rhs})`,
    });
  }

  // `v-model="scope.member"` lowers to the bridged value plus an explicit
  // scope write, mirroring the Angular two-way allow-list.
  for (const model of vModelBindings) {
    const scope = scopeByName.get(model.scope);
    if (!scope) continue;

    const resolution = resolveScopePath(scope.members, model.path);
    if (resolution.kind === 'missing' || resolution.kind === 'opaque') {
      // Reported once by the usage pass above.
      continue;
    }

    if (resolution.kind !== 'source' || resolution.depth !== model.path.length) {
      diagnostics.push({
        category: 'error',
        message:
          `v-model cannot write to ${JSON.stringify(scopeLabel(model.scope, model.path))}: ` +
          'only writable scope atoms can be lowered.',
        start: templateOffset + model.start,
        length: model.end - model.start,
      });
      continue;
    }

    const bridge = bridgeName(model.scope, model.path);
    const inputType = staticAttributeValue(model.attributes, 'type')?.toLowerCase();
    const unsupportedNative =
      (model.element === 'input' && inputType !== undefined && !['text', 'search', 'email', 'url', 'tel', 'password'].includes(inputType)) ||
      (model.element === 'select' && hasStaticAttribute(model.attributes, 'multiple'));
    const mapping = unsupportedNative ? undefined : V_MODEL_NATIVE[model.element];

    if (!mapping) {
      diagnostics.push({
        category: 'error',
        message:
          `v-model on <${model.element}> cannot be compiled for ${JSON.stringify(scopeLabel(model.scope, model.path))}. ` +
          'Bind :value and an explicit scope.set(...) handler instead.',
        start: templateOffset + model.start,
        length: model.end - model.start,
      });
      continue;
    }

    // Lowering writes a fresh `:value` / event pair. Emitting it next to an
    // authored one produces duplicate attributes, which Vue's parser rejects.
    const authoredValue = !matchAttributes(model.attributes, /^\s*(?::value|v-bind:value)(?:\.[\w-]+)*\s*=/g).next().done;
    const authoredEvent = !matchAttributes(model.attributes, new RegExp(
      `^\\s*(?:@${mapping.event}|v-on:${mapping.event})(?:\\.[\\w-]+)*\\s*=`, 'g',
    )).next().done;
    if (authoredValue || authoredEvent) {
      const attribute = authoredValue ? ':value' : `@${mapping.event}`;
      diagnostics.push({
        category: 'error',
        message:
          `v-model on ${JSON.stringify(scopeLabel(model.scope, model.path))} cannot be combined with an authored ` +
          `${attribute} attribute on <${model.element}>. Use either v-model or explicit bindings, not both.`,
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
        `@${mapping.event}="${scopeSetCall(model.scope, model.path)}${mapping.value})"`,
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

/** Root identifier of a member chain, when it names a declared scope. */
function scopeRootName(node: ts.Expression, scopes: ReadonlySet<string>): string | undefined {
  let current = node;

  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }

  return ts.isIdentifier(current) && scopes.has(current.text) ? current.text : undefined;
}

/** Reject shapes the compiler cannot lower without changing Vue semantics. */
function unsupportedTemplateDiagnostics(
  template: string,
  templateOffset: number,
  declarations: readonly ReactiveDeclaration[],
  localsAt: TemplateLocalsAt,
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
    const shadowed = (node: ts.Node, root: string): boolean =>
      localsAt(span.start + node.getStart(file) - prefix).has(root) ||
      isShadowedIn(node, file, root);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const root = scopeRootName(node, scopes);
        if (root && !shadowed(node, root) &&
            (ts.isElementAccessExpression(node) || node.questionDotToken)) {
          add(span.start + node.getStart(file) - prefix, node.end - node.getStart(file),
            `Unsupported dynamic scope access on ${root}. Use scope.get(...) in script and bind the returned ref.`);
        }
      }
      let write: ts.Expression | undefined;
      if (ts.isBinaryExpression(node) && isAssignmentKind(node.operatorToken.kind) &&
          node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) write = node.left;
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) write = node.operand;
      const writeRoot = write && scopeRootName(write, scopes);
      if (writeRoot && !shadowed(write!, writeRoot)) {
        add(span.start + write!.getStart(file) - prefix, write!.end - write!.getStart(file),
          `Unsupported compound scope write on ${writeRoot}. Use an explicit scope.set(...) handler.`);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const leftRoot = scopeRootName(node.left, scopes);
        if (leftRoot && !shadowed(node.left, leftRoot)) {
          const containsNestedWrite = (child: ts.Node): boolean => {
            if (ts.isBinaryExpression(child) && isAssignmentKind(child.operatorToken.kind)) {
              const childRoot = scopeRootName(child.left, scopes);
              if (childRoot && !shadowed(child.left, childRoot)) return true;
            }
            return ts.forEachChild(child, containsNestedWrite) ?? false;
          };
          if (containsNestedWrite(node.right)) {
            add(span.start + node.getStart(file) - prefix, node.end - node.getStart(file),
              'Nested scope assignments are unsupported. Use separate scope.set(...) statements.');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  for (const tag of openingTags(template)) {
    for (const match of matchAttributes(tag.attributes, /^\s*(v-model(?:[:.][\w-]+)+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      add(tag.attributesStart + match.index!, match[0].length,
        'v-model arguments and modifiers are not compiled. Use :value and an explicit scope.set(...) handler.');
    }
    for (const match of matchAttributes(tag.attributes, /^\s*v-model\s*=\s*(["'])([\s\S]*?)\1/g)) {
      const expression = match[2].trim();
      const root = /^([A-Za-z_$][\w$]*)\s*(?:\.|\[)/.exec(expression)?.[1];
      if (!root || !reactiveNames.has(root)) continue;
      // A loop alias or slot prop can reuse a reactive name without touching
      // the outer binding; only an actual outer read is a v-model error.
      if (localsAt(tag.attributesStart + match.index!).has(root)) continue;
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
  localsAt: TemplateLocalsAt,
): readonly VueSfcDiagnostic[] {
  const readonlyNames = new Set(declarations.filter(item =>
    item.kind === 'derived' || item.kind === 'flow').map(item => item.name));
  const diagnostics: VueSfcDiagnostic[] = [];
  if (readonlyNames.size === 0) return diagnostics;

  for (const tag of openingTags(template)) {
    for (const model of matchAttributes(tag.attributes, /^\s*v-model\s*=\s*(["'])([\s\S]*?)\1/g)) {
      const name = model[2].trim();
      if (!readonlyNames.has(name)) continue;
      // A loop alias or slot prop with the same name is a different binding.
      if (localsAt(tag.attributesStart + model.index!).has(name)) continue;
      diagnostics.push({ category: 'error', start: templateOffset + tag.attributesStart + model.index!,
        length: model[0].length, message: `v-model cannot write to read-only Streamix binding ${JSON.stringify(name)}.` });
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
      if (target && ts.isIdentifier(target) && readonlyNames.has(target.text) &&
          !localsAt(span.start + target.getStart(file) - prefix).has(target.text) &&
          !isShadowedIn(target, file, target.text)) {
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
  // Unaliased value imports from the bridge module are reused as-is; every
  // other binding with a required name would shadow or duplicate the
  // generated import.
  const reusableRuntimeImports = new Set<string>();

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
        const runtimeModule = ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === '@epikodelabs/streamix/vue';
        for (const item of bindings.elements) {
          existing.add(item.name.text);
          if (runtimeModule && !clause?.isTypeOnly && !item.isTypeOnly && !item.propertyName) {
            reusableRuntimeImports.add(item.name.text);
          }
        }
      }
    }
  }

  for (const name of reusableRuntimeImports) existing.delete(name);

  const generated = declarations.filter(item => item.kind !== 'scope').map(item => reactiveBridgeName(item.name));
  for (const scope of declarations.filter(item => item.kind === 'scope')) {
    for (const path of bridgeableScopePaths(scope.members)) {
      generated.push(bridgeName(scope.name, path));
    }
  }
  // The compiler emits these composable calls; a same-named local binding or
  // non-bridge import would either duplicate the generated import or silently
  // bind generated calls to authored code.
  generated.push(...BRIDGE_COMPOSABLES);

  return [...new Set(generated)].filter(name => existing.has(name)).map(name => ({
    category: 'error' as const,
    message: `Generated Streamix Vue binding ${JSON.stringify(name)} collides with an existing setup declaration. Rename the authored declaration.`,
    start: scriptOffset,
    length: 0,
  }));
}

function bridgeName(scope: string, path: readonly string[]): string {
  // Hex encoding is identifier-safe and preserves component boundaries, so
  // `a_b.c` cannot collide with `a.b_c`, and quoted keys remain valid.
  return `${BRIDGE_PREFIX}${encodeBridgePart(scope)}_${encodeBridgePart(path.join('.'))}`;
}

function encodeBridgePart(value: string): string {
  return [...value].map(char => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
}

function reactiveBridgeName(name: string): string {
  return `${BRIDGE_PREFIX}${name}`;
}

/** `state.get('profile').get('name')` for `[profile, name]`. */
function scopePathAccess(scope: string, path: readonly string[]): string {
  return path.reduce(
    (access, segment) => `${access}.get('${escapeSingleQuotes(segment)}')`,
    scope,
  );
}

/** `state.set('count', ` for `[count]`, `state.get('a').set('b', ` for `[a, b]`. */
function scopeSetCall(scope: string, path: readonly string[]): string {
  const last = path[path.length - 1];
  return `${scopePathAccess(scope, path.slice(0, -1))}.set('${escapeSingleQuotes(last)}', `;
}

type ScopePathResolution =
  | { readonly kind: 'source'; readonly depth: number }
  | { readonly kind: 'method'; readonly depth: number }
  | { readonly kind: 'nested'; readonly depth: number }
  | { readonly kind: 'missing'; readonly depth: number }
  | { readonly kind: 'opaque'; readonly depth: number };

/**
 * Resolves a template member path through the statically known scope tree.
 *
 * A `source` result stops at the first atom/readable member; any further path
 * segments read properties of its value. Nested scopes, methods, missing
 * members, and uninspectable nested scopes are reported distinctly so the
 * compiler never guesses that a callable member is a source.
 */
function resolveScopePath(
  members: readonly ScopeMemberDeclaration[],
  path: readonly string[],
): ScopePathResolution {
  let current = members;

  for (let index = 0; index < path.length; index++) {
    const member = current.find(item => item.name === path[index]);
    if (!member) return { kind: 'missing', depth: index };

    if (member.kind === 'source') return { kind: 'source', depth: index + 1 };
    if (member.kind === 'method') return { kind: 'method', depth: index + 1 };

    // Nested scope. A factory the compiler cannot inspect makes every deeper
    // member unknowable; reading the nested scope itself stays untouched.
    if (index === path.length - 1) return { kind: 'nested', depth: index + 1 };
    if (member.opaque) return { kind: 'opaque', depth: index + 1 };
    current = member.members;
  }

  return { kind: 'nested', depth: path.length };
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
    // `import type { useWritable }` supplies no runtime value, so it must not
    // suppress the generated value import.
    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        // An aliased import doesn't provide the generated unaliased binding.
        if (!binding.propertyName && !binding.isTypeOnly) imported.add(binding.name.text);
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
  const methodAliases = new Set<string>();
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

        if (isStreamix && imported === 'method') {
          methodAliases.add(item.name.text);
        } else if (isStreamix && imported === 'pipe') {
          aliases.set(item.name.text, 'flow');
        } else if (isStreamix && FACTORY_NAMES.has(imported as FactoryKind)) {
          aliases.set(item.name.text, imported as FactoryKind);
        }
      }
    }
  }

  return { aliases, methodAliases };
}

/**
 * Strips value-transparent wrappers (parentheses, `as`/angle-bracket
 * assertions, non-null assertions, `satisfies`) so cast-wrapped factory
 * initializers such as `atom(0) as Writable<number>` adopt like the bare call
 * they contain. React parity: the React compiler applies the same unwrap to
 * declaration initializers and factory callbacks.
 */
function unwrapCast(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectReactiveDeclarations(
  script: string,
  imports: FactoryImports,
): ReactiveDeclaration[] {
  const declarations: ReactiveDeclaration[] = [];
  const file = ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    // const and let (and legacy var) declarations adopt alike, mirroring the
    // React compiler; the binding kind never gates reactivity.

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      // Casts and the introspection wrapper may nest in either order; peel
      // value-transparent layers until a factory call (or nothing) remains.
      let call: ts.CallExpression | undefined;
      let current = unwrapCast(declaration.initializer);
      for (;;) {
        if (!ts.isCallExpression(current)) break;
        const inner = unwrapIntrospectionWrapper(current);
        if (inner === current) { call = current; break; }
        current = unwrapCast(inner);
      }
      if (!call || !ts.isIdentifier(call.expression)) continue;
      const callee = call.expression.text;
      const aliased = imports.aliases.get(callee);
      // Adopt only an explicit Streamix import. A same-named local helper is
      // ordinary application code and must never be silently transformed.
      const kind = aliased;

      if (!kind || !FACTORY_NAMES.has(kind)) continue;

      declarations.push({
        name: declaration.name.text,
        kind,
        callExpressionStart: call.expression.getStart(file),
        callEnd: call.end,
        statementEnd: statement.end,
        members: kind === 'scope' ? scopeMemberDeclarations(call, imports) : [],
      });
    }
  }

  return declarations;
}

/**
 * The instrumenting builders wrap factory calls in `__sxDebug(call, metadata)`
 * (the alias grows trailing underscores on name collisions). Adoption and
 * bridge spans key on the factory call, never on the wrapper around it.
 */
function unwrapIntrospectionWrapper(call: ts.CallExpression): ts.Expression {
  const callee = call.expression;
  if (ts.isIdentifier(callee) && /^__sxDebug_*$/.test(callee.text) && call.arguments.length > 0) {
    const inner = call.arguments[0];
    return unwrapCast(inner);
  }
  return call;
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
  localsAt: TemplateLocalsAt,
): readonly TemplateReactiveRead[] {
  const names = new Set(declarations.map(declaration => declaration.name));
  const reads: TemplateReactiveRead[] = [];

  for (const span of templateExpressionSpans(template)) {
    const expression = template.slice(span.start, span.end);
    // Wrapping produces a normal expression source file and prevents strings,
    // comments, and object keys from being mistaken for reactive identifiers.
    const { file, prefix } = parseTemplateExpression(expression);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && names.has(node.text) && isValueIdentifier(node) &&
          !localsAt(span.start + node.getStart(file) - prefix).has(node.text) &&
          !isShadowedIn(node, file, node.text)) {
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
    for (const match of matchAttributes(tag.attributes, /^\s*v-model\s*=\s*(["'])([A-Za-z_$][\w$]*)\1/g)) {
      const name = match[2];
      if (!names.has(name)) continue;
      // The model's root may be a loop alias or slot prop, not the binding.
      if (localsAt(tag.attributesStart + match.index!).has(name)) continue;
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
  imports: FactoryImports,
  scriptOffset: number,
  diagnostics: VueSfcDiagnostic[],
): readonly SpanEdit[] {
  const atoms = new Set(declarations.filter(item => item.kind !== 'scope').map(item => item.name));
  if (![...imports.aliases.values()].includes('derived')) return [];
  const file = ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true);
  const edits: SpanEdit[] = [];
  const isDerivedCall = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
    imports.aliases.get(node.expression.text) === 'derived' &&
    !isShadowedIn(node.expression, file, node.expression.text, false);
  const lowerFormula = (callback: ts.ArrowFunction | ts.FunctionExpression): void => {
    if (ts.getModifiers(callback)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      diagnostics.push({
        category: 'error',
        message: 'derived() formulas must return synchronously. Use flow() for async work.',
        start: scriptOffset + callback.getStart(file),
        length: callback.getWidth(file),
      });
    }
    const body = callback.body;
    const trackerNames = new Set(callback.parameters.flatMap(parameter =>
      ts.isIdentifier(parameter.name) ? [parameter.name.text] : []));
    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node) || isDerivedCall(node)) return;
      // DerivedScope readers receive source references, whatever their name.
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const reader = ts.isPropertyAccessExpression(callee) &&
          ['read', 'use'].includes(callee.name.text) ? callee.expression : callee;
        if (ts.isIdentifier(reader) && trackerNames.has(reader.text) &&
            !isShadowedIn(reader, callback.body, reader.text)) return;
      }
      if (ts.isIdentifier(node) && atoms.has(node.text) &&
          isValueIdentifier(node) && !isShadowedIn(node, file, node.text, false)) {
        const start = node.getStart(file);
        const shorthand = ts.isShorthandPropertyAssignment(node.parent);
        edits.push({ start, end: node.end,
          replacement: shorthand ? `${node.text}: ${node.text}.value` : `${node.text}.value` });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  };
  const scan = (node: ts.Node): void => {
    if (isDerivedCall(node) && node.arguments[0]) {
      const callback = unwrapCast(node.arguments[0]);
      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) lowerFormula(callback);
    }
    ts.forEachChild(node, scan);
  };
  scan(file);
  return edits;
}

/**
 * Members that belong to the source object itself. Appending `.value` before
 * one of them would read the wrong API (`source.value.set(...)`), or unwrap
 * twice (`source.value.safeValue`).
 */
const SOURCE_API_MEMBERS = new Set([
  'value', 'safeValue', 'previous', 'disposed', 'dirty', 'error',
  'subscriberCount', 'subscribe', 'onError', 'dispose',
  'next', 'set', 'fail', 'recover', 'clearError',
]);

/**
 * True when the identifier is the receiver of a member access that reads a
 * source API rather than the source's value, including through parentheses
 * or type-only wrappers.
 *
 * Ordinary value methods (`items.map(...)`) and literal indexes
 * (`items[0]`) still count as plain value reads. A non-literal element
 * access or a literal source-API member is left untouched: its meaning
 * cannot be lowered safely.
 */
function isSourceApiReceiver(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  for (;;) {
    const parent = current.parent;
    if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) ||
        ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      return SOURCE_API_MEMBERS.has(parent.name.text);
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === current) {
      const argument = parent.argumentExpression;
      return !!argument && ts.isStringLiteralLike(argument) && SOURCE_API_MEMBERS.has(argument.text);
    }
    return false;
  }
}

/** Only value references are rewritten, never types, declarations or keys. */
function isValueIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  // Source API access is object access, not a plain value read. Authored
  // `source.value` is already unwrapped and must not gain a second `.value`.
  if (isSourceApiReceiver(node)) return false;
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
function isShadowedIn(node: ts.Node, body: ts.Node, name: string, includeBoundary = true): boolean {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (scope === body && !includeBoundary) break;
    if (hoistedVarDeclarations(scope).some(declaration => containsBinding(declaration.name, name))) return true;
    if ((ts.isFunctionExpression(scope) || ts.isFunctionDeclaration(scope) || ts.isClassLike(scope)) && scope.name?.text === name) return true;
    if (ts.isFunctionLike(scope) && scope.parameters?.some(param => containsBinding(param.name, name))) return true;
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      if (scope.statements.some(statement =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl => containsBinding(decl.name, name)) ||
        ts.isFunctionDeclaration(statement) && statement.name?.text === name ||
        ts.isClassDeclaration(statement) && statement.name?.text === name)) return true;
    }
    // Brace-less switch arms share the switch's scope, so their declarations
    // shadow just like block statements do.
    if (ts.isCaseBlock(scope)) {
      if (scope.clauses.some(clause => clause.statements.some(statement =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl => containsBinding(decl.name, name)) ||
        ts.isFunctionDeclaration(statement) && statement.name?.text === name ||
        ts.isClassDeclaration(statement) && statement.name?.text === name))) return true;
    }
    // Catch parameters and loop headers (for/for-of/for-in, including for
    // await) bind names exactly like parameters do.
    if (ts.isCatchClause(scope) && scope.variableDeclaration && containsBinding(scope.variableDeclaration.name, name)) return true;
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
        scope.initializer && ts.isVariableDeclarationList(scope.initializer) &&
        scope.initializer.declarations.some(decl => containsBinding(decl.name, name))) return true;
    if (scope === body) break;
  }
  return false;
}

/** Generated bridges exist only for statically proven source members. */
function bridgeableScopePaths(
  members: readonly ScopeMemberDeclaration[],
  prefix: readonly string[] = [],
): string[][] {
  const paths: string[][] = [];

  for (const member of members) {
    const path = [...prefix, member.name];
    if (member.kind === 'source') paths.push(path);
    else if (member.kind === 'nested') paths.push(...bridgeableScopePaths(member.members, path));
  }

  return paths;
}

function scopeMemberDeclarations(
  call: ts.CallExpression,
  imports: FactoryImports,
): readonly ScopeMemberDeclaration[] {
  const argument = call.arguments[0];

  return argument && ts.isObjectLiteralExpression(argument)
    ? objectLiteralScopeMembers(argument, imports)
    : [];
}

function objectLiteralScopeMembers(
  literal: ts.ObjectLiteralExpression,
  imports: FactoryImports,
): readonly ScopeMemberDeclaration[] {
  const members: ScopeMemberDeclaration[] = [];

  for (const property of literal.properties) {
    let name: string | undefined;
    let initializer: ts.Expression | undefined;

    if (ts.isPropertyAssignment(property)) {
      name = staticPropertyName(property.name);
      initializer = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      // A shorthand binding is often an imported atom. Classify it as a
      // source; `useScopeMember` keeps a callable value untouched if the
      // binding turns out to be a method or a nested scope.
      name = property.name.text;
      initializer = property.name;
    }

    if (name === undefined || !initializer) continue;
    members.push(classifyScopeMember(name, initializer, imports));
  }

  return members;
}

function staticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function classifyScopeMember(
  name: string,
  initializer: ts.Expression,
  imports: FactoryImports,
): ScopeMemberDeclaration {
  const value = unwrapCast(initializer);

  // Bare callbacks are config-form derived values (`scope()` wraps them in a
  // dynamic expression), not imperative methods.
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return { name, kind: 'source', members: [] };
  }

  if (ts.isObjectLiteralExpression(value)) {
    return { name, kind: 'nested', members: objectLiteralScopeMembers(value, imports) };
  }

  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
    const imported = imports.aliases.get(value.expression.text);

    // Safety wins over guessing: a call shaped like the core helper is never
    // treated as a source factory, even when its import is aliased or absent.
    if (imports.methodAliases.has(value.expression.text) || value.expression.text === 'method') {
      return { name, kind: 'method', members: [] };
    }

    if (imported === 'scope') {
      const argument = value.arguments[0];
      return argument && ts.isObjectLiteralExpression(argument)
        ? { name, kind: 'nested', members: objectLiteralScopeMembers(argument, imports) }
        : { name, kind: 'nested', members: [], opaque: true };
    }
  }

  return { name, kind: 'source', members: [] };
}

interface ScopeMemberChain {
  readonly scope: string;
  /** Dotted member path below the scope. */
  readonly path: readonly string[];
}

/** Reads a whole `scope.member.path` chain; optional segments stop the walk. */
function scopeMemberChain(node: ts.Node, scopeNames: ReadonlySet<string>): ScopeMemberChain | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;

  const path: string[] = [];
  let current: ts.Expression = node;

  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken) return undefined;
    path.unshift(current.name.text);
    current = current.expression;
  }

  if (!ts.isIdentifier(current) || !scopeNames.has(current.text)) return undefined;
  return { scope: current.text, path };
}

function collectTemplateUsage(
  template: string,
  declarations: readonly ReactiveDeclaration[],
  localsAt: TemplateLocalsAt,
): TemplateUsage {
  const scopeNames = new Set(declarations.filter(item => item.kind === 'scope').map(item => item.name));
  const reactiveNames = new Set(declarations.filter(item => item.kind !== 'scope').map(item => item.name));
  const reads: ScopeMemberRead[] = [];
  const writes: ScopeMemberWrite[] = [];

  for (const span of templateExpressionSpans(template)) {
    const expression = template.slice(span.start, span.end);
    const { file, prefix } = parseTemplateExpression(expression);
    const shadowedName = (absoluteOffset: number, name: string): boolean =>
      localsAt(absoluteOffset).has(name);
    const shadowed = (node: ts.Node, name: string): boolean =>
      shadowedName(span.start + node.getStart(file) - prefix, name) ||
      isShadowedIn(node, file, name);
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = scopeMemberChain(node.left, scopeNames);
        if (target && !shadowed(node.left, target.scope)) {
          const rhsStart = span.start + node.right.getStart(file) - prefix;
          const rhs = expression.slice(node.right.getStart(file) - prefix, node.right.end - prefix);
          const rewritten = rewriteReactiveReadsInText(
            rewriteReadsInText(rhs, declarations, reads, rhsStart, shadowedName),
            reactiveNames,
            rhsStart,
            shadowedName,
          );
          writes.push({
            start: span.start + node.getStart(file) - prefix,
            end: span.start + node.end - prefix,
            scope: target.scope,
            path: target.path,
            rhs: rewritten,
          });
          // Nested assignments require explicit sequencing, not overlapping edits.
          return;
        }
      }
      const chain = scopeMemberChain(node, scopeNames);
      if (chain && !shadowed(node, chain.scope)) {
        reads.push({
          start: span.start + node.getStart(file) - prefix,
          end: span.start + node.end - prefix,
          scope: chain.scope,
          path: chain.path,
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
function rewriteReactiveReadsInText(
  fragment: string,
  reactiveNames: ReadonlySet<string>,
  absoluteStart: number,
  shadowedName: (absoluteOffset: number, name: string) => boolean,
): string {
  if (reactiveNames.size === 0) return fragment;
  const { file, prefix } = parseTemplateExpression(fragment);
  const edits: SpanEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && reactiveNames.has(node.text) && isValueIdentifier(node) &&
        !shadowedName(absoluteStart + node.getStart(file) - prefix, node.text) &&
        !isShadowedIn(node, file, node.text)) {
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

/** Rewrites source-member reads inside a right-hand-side fragment. */
function rewriteReadsInText(
  fragment: string,
  declarations: readonly ReactiveDeclaration[],
  reads: ScopeMemberRead[],
  absoluteStart: number,
  shadowedName: (absoluteOffset: number, name: string) => boolean,
): string {
  const scopes = new Map(
    declarations
      .filter((item): item is ReactiveDeclaration & { kind: 'scope' } => item.kind === 'scope')
      .map(scope => [scope.name, scope]),
  );
  const scopeNames = new Set(scopes.keys());
  const { file, prefix } = parseTemplateExpression(fragment);
  const edits: SpanEdit[] = [];
  const visit = (node: ts.Node): void => {
    const chain = scopeMemberChain(node, scopeNames);
    const start = node.getStart(file) - prefix;
    if (chain &&
        !shadowedName(absoluteStart + start, chain.scope) &&
        !isShadowedIn(node, file, chain.scope)) {
      const end = node.end - prefix;
      reads.push({ start: absoluteStart + start, end: absoluteStart + end,
        scope: chain.scope, path: chain.path });

      const scope = scopes.get(chain.scope)!;
      const resolution = resolveScopePath(scope.members, chain.path);
      if (resolution.kind === 'source') {
        const prefixPath = chain.path.slice(0, resolution.depth);
        const rest = chain.path.slice(resolution.depth);
        edits.push({
          start,
          end,
          replacement: rest.length === 0
            ? bridgeName(chain.scope, prefixPath)
            : `${bridgeName(chain.scope, prefixPath)}.${rest.join('.')}`,
        });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return edits.length === 0
    ? fragment
    : applyEdits(fragment, edits.sort((a, b) => b.start - a.start));
}

interface VModelScopeBinding {
  readonly element: string;
  readonly attributes: string;
  readonly scope: string;
  readonly path: readonly string[];
  readonly start: number;
  readonly end: number;
}

function collectVModelScopeBindings(
  template: string,
  declarations: readonly ReactiveDeclaration[],
  localsAt: TemplateLocalsAt,
): readonly VModelScopeBinding[] {
  const scopeNames = new Set(declarations.filter(item => item.kind === 'scope').map(item => item.name));
  const bindings: VModelScopeBinding[] = [];

  for (const tag of openingTags(template)) {
    for (const model of matchAttributes(tag.attributes, /^\s*(v-model)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      const match = /^([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*)+)$/.exec(model[3].trim());
      if (!match || !scopeNames.has(match[1])) continue;
      // A loop alias or slot prop with the same name is not the scope.
      if (localsAt(tag.attributesStart + model.index!).has(match[1])) continue;
      const start = tag.attributesStart + model.index! + model[0].indexOf('v-model');
      bindings.push({
        element: tag.name,
        attributes: tag.attributes,
        scope: match[1],
        path: match[2].slice(1).split('.'),
        start,
        end: start + model[0].trimStart().length,
      });
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

/** Minimal structural view of Vue's parsed template AST. */
interface TemplateAstNode {
  readonly type: number;
  readonly loc?: {
    readonly start: { readonly offset: number };
    readonly end: { readonly offset: number };
  };
  readonly props?: readonly TemplateAstProp[];
  readonly children?: readonly TemplateAstNode[];
}

interface TemplateAstProp {
  readonly type: number;
  readonly name?: string;
  readonly exp?: {
    readonly content?: string;
    readonly loc?: {
      readonly start: { readonly offset: number };
      readonly end: { readonly offset: number };
    };
  };
}

/** A template-local binding range (`v-for` aliases or slot props). */
interface TemplateLocalScope {
  /** Template-relative offsets. */
  readonly start: number;
  readonly end: number;
  readonly names: ReadonlySet<string>;
  /** The `v-for` expression where its own aliases are not in scope. */
  readonly exclude?: { readonly start: number; readonly end: number };
}

const EMPTY_TEMPLATE_LOCALS: ReadonlySet<string> = new Set();

/** Template-local names in scope at a template-relative offset. */
type TemplateLocalsAt = (offset: number) => ReadonlySet<string>;

function collectBindingIdentifiers(name: ts.BindingName, names: string[]): void {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingIdentifiers(element.name, names);
  }
}

function bindingNamesFromPattern(pattern: string, prefix: string, suffix: string): ReadonlySet<string> {
  const file = ts.createSourceFile(
    'template-bindings.ts',
    `${prefix}${pattern}${suffix}`,
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      collectBindingIdentifiers(node.name, names);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return new Set(names);
}

/** Finds the top-level `in`/`of` separating a v-for alias from its source. */
function splitForExpression(
  expression: string,
): { aliasEnd: number; sourceStart: number } | undefined {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let index = 0; index < expression.length; index++) {
    const char = expression[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth--;
      continue;
    }
    if (depth !== 0 || !/\s/.test(char)) continue;

    const match = /^\s+(?:in|of)\s+/.exec(expression.slice(index));
    if (match) {
      return {
        aliasEnd: index,
        sourceStart: index + match[0].length,
      };
    }
  }

  return undefined;
}

function forAliasNames(expression: string | undefined): ReadonlySet<string> {
  if (!expression) return EMPTY_TEMPLATE_LOCALS;
  const split = splitForExpression(expression);
  if (!split) return EMPTY_TEMPLATE_LOCALS;

  let pattern = expression.slice(0, split.aliasEnd).trim();
  if (pattern.startsWith('(') && pattern.endsWith(')')) {
    pattern = pattern.slice(1, -1);
  }
  if (!pattern) return EMPTY_TEMPLATE_LOCALS;
  return bindingNamesFromPattern(pattern, 'const [', '] = [];');
}

function slotAliasNames(expression: string | undefined): ReadonlySet<string> {
  if (!expression?.trim()) return EMPTY_TEMPLATE_LOCALS;
  return bindingNamesFromPattern(expression.trim(), 'const ', ' = {};');
}

/**
 * Collects the lexical ranges introduced by Vue template constructs.
 *
 * `v-for` aliases apply to the whole element (except the v-for expression
 * itself); slot props apply to the slot's child content. Nested ranges are
 * retained separately, so callers can union every scope containing an
 * expression.
 */
function collectTemplateLocalScopes(
  ast: TemplateAstNode | undefined,
  templateOffset: number,
): readonly TemplateLocalScope[] {
  if (!ast) return [];
  const scopes: TemplateLocalScope[] = [];

  const visit = (node: TemplateAstNode): void => {
    const forDirective = node.props?.find(prop => prop.type === 7 && prop.name === 'for');
    const slotDirective = node.props?.find(prop => prop.type === 7 && prop.name === 'slot');

    if (node.type === 1 && node.loc) {
      const aliases = forAliasNames(forDirective?.exp?.content);
      if (aliases.size > 0) {
        scopes.push({
          start: node.loc.start.offset - templateOffset,
          end: node.loc.end.offset - templateOffset,
          names: aliases,
          exclude: forDirective?.exp?.loc
            ? {
              start: forDirective.exp.loc.start.offset - templateOffset,
              end: forDirective.exp.loc.end.offset - templateOffset,
            }
            : undefined,
        });
      }

      const slotNames = slotAliasNames(slotDirective?.exp?.content);
      const firstChild = node.children?.[0];
      if (slotNames.size > 0 && firstChild?.loc) {
        scopes.push({
          start: firstChild.loc.start.offset - templateOffset,
          end: node.loc.end.offset - templateOffset,
          names: slotNames,
        });
      }
    }

    for (const child of node.children ?? []) visit(child);
  };

  visit(ast);
  return scopes;
}

/** Union of template-local names in scope at one template-relative offset. */
function templateLocalsAt(
  scopes: readonly TemplateLocalScope[],
  offset: number,
): ReadonlySet<string> {
  let names: Set<string> | undefined;
  for (const scope of scopes) {
    if (offset < scope.start || offset >= scope.end) continue;
    if (scope.exclude && offset >= scope.exclude.start && offset < scope.exclude.end) {
      continue;
    }
    names ??= new Set();
    for (const name of scope.names) names.add(name);
  }
  return names ?? EMPTY_TEMPLATE_LOCALS;
}

/**
 * Directive values that are not plain JS expressions, or whose expressions
 * are handled by dedicated passes. Every other directive value is scanned,
 * including custom directives (`v-tooltip="count"`) and `v-memo`.
 */
const NON_EXPRESSION_DIRECTIVE_VALUES = new Set([
  'model', 'slot', 'pre', 'once', 'cloak', 'else',
]);

/**
 * Expression positions Vue evaluates: interpolation contents and every
 * value-bearing directive (including argument-less custom directives and
 * `v-memo`). Same-name `:foo` / `v-bind:foo` shorthands have no value and are
 * expanded separately. Static attributes and prose are never returned.
 */
function templateExpressionSpans(template: string): TemplateExpressionSpan[] {
  const spans: TemplateExpressionSpan[] = [];

  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    spans.push({
      start: match.index! + 2,
      end: match.index! + match[0].length - 2,
    });
  }

  for (const tag of openingTags(template)) {
    for (const match of matchAttributes(tag.attributes,
      /^\s*(?:[:@][\w.:[\]-]+|v-([A-Za-z][\w-]*)(?::[\w.:[\]-]+)?(?:\.[\w-]+)*)\s*=\s*(["'])([\s\S]*?)\2$/g,
    )) {
      const directive = match[1]?.toLowerCase();
      if (directive && NON_EXPRESSION_DIRECTIVE_VALUES.has(directive)) continue;
      const valueStart = tag.attributesStart + match.index! + match[0].length - match[3].length - 1;
      if (directive === 'for') {
        // The aliases are binding patterns. Only rewrite the iterated source.
        const split = splitForExpression(match[3]);
        if (!split) continue;
        spans.push({ start: valueStart + split.sourceStart, end: valueStart + match[3].length });
      } else {
        spans.push({ start: valueStart, end: valueStart + match[3].length });
      }
    }
  }

  return spans;
}

/**
 * Vue 3.4 same-name bindings (`:title`, `v-bind:title`) evaluate the
 * identifier as their value. The attribute text must be expanded so the
 * generated bridge keeps the authored prop name while binding the bridged
 * value.
 */
function sameNameBindingEdits(
  template: string,
  declarations: readonly ReactiveDeclaration[],
  localsAt: TemplateLocalsAt,
): readonly SpanEdit[] {
  const reactiveNames = new Set(
    declarations.filter(item => item.kind !== 'scope').map(item => item.name),
  );
  const edits: SpanEdit[] = [];

  for (const tag of openingTags(template)) {
    for (const match of matchAttributes(tag.attributes,
      /^\s*((:|v-bind:)([A-Za-z_$][\w$]*))$/g,
    )) {
      const name = match[3];
      if (!reactiveNames.has(name)) continue;
      // Inside a loop or slot, the shorthand reads the local alias rather
      // than the outer Streamix binding.
      if (localsAt(tag.attributesStart + match.index!).has(name)) continue;
      const start = tag.attributesStart + match.index! + match[0].indexOf(match[1]);
      edits.push({
        start,
        end: start + match[1].length,
        replacement: `${match[2]}${name}="${reactiveBridgeName(name)}"`,
      });
    }
  }

  return edits;
}
