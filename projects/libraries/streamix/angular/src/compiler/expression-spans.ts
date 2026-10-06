export interface SxExpressionSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Returns Angular-evaluated expression contexts only: interpolation contents,
 * quoted property/directive/event binding values, and control-flow conditions
 * (including `@else if`). Static attribute values and prose are never
 * returned, so recorded paths cannot leak into non-expression text.
 */
export function angularExpressionSpans(template: string): SxExpressionSpan[] {
  const spans: SxExpressionSpan[] = [];

  const push = (start: number, end: number): void => {
    if (end > start) {
      spans.push({ start, end, text: template.slice(start, end) });
    }
  };

  // Quoted value of an attribute-shaped binding: the value ends exactly one
  // character (the closing quote) before the end of the match.
  const pushQuoted = (match: RegExpMatchArray, group: number): void => {
    const value = match[group] ?? '';
    const start = match.index! + match[0].length - value.length - 1;
    push(start, start + value.length);
  };

  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    push(match.index! + 2, match.index! + match[0].length - 2);
  }

  for (const match of template.matchAll(/\[[^\]]+\]\s*=\s*(["'])([\s\S]*?)\1/g)) {
    pushQuoted(match, 2);
  }

  for (const match of template.matchAll(/\*ng[A-Za-z_$][\w$]*\s*=\s*(["'])([\s\S]*?)\1/g)) {
    pushQuoted(match, 2);
  }

  for (const match of template.matchAll(/\(([^)]+)\)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    pushQuoted(match, 3);
  }

  for (const match of template.matchAll(/@(?:else\s+)?(?:if|switch|for)\s*\(([\s\S]*?)\)/g)) {
    const openParen = match.index! + match[0].indexOf('(') + 1;
    push(openParen, match.index! + match[0].length - 1);
  }

  return spans;
}

/**
 * Applies recorded path replacements inside expression spans only, in one
 * longest-first pass. Longest-first keeps a longer recorded path
 * (`state.items`) from being clobbered by a recorded prefix (`state`), and
 * the span restriction keeps static attributes, prose, and string literals
 * inside expressions untouched.
 */
export function rewriteExpressionSpans(
  template: string,
  spans: readonly SxExpressionSpan[],
  replacements: ReadonlyMap<string, string>,
): string {
  const paths = [...replacements.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\w$.])(?:${paths.map(escapeRegExp).join('|')})(?![\\w$])`,
    'g',
  );
  const rewrite = (text: string): string =>
    text.replace(pattern, (match, offset: number) =>
      isInsideString(text, offset) ? match : replacements.get(match)!,
    );

  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;

  for (const span of ordered) {
    if (span.start < cursor) {
      // Nested span; the enclosing rewrite already covered its text.
      continue;
    }

    result += template.slice(cursor, span.start) + rewrite(span.text);
    cursor = span.end;
  }

  return result + template.slice(cursor);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function componentPathsInExpression(expression: string): readonly string[] {
  const paths: string[] = [];
  const pattern = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\b/g;

  for (const match of expression.matchAll(pattern)) {
    if (match.index == null || isInsideString(expression, match.index)) {
      continue;
    }
    paths.push(match[0]);
  }

  return paths;
}

export function isInsideString(expression: string, offset: number): boolean {
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < offset; index += 1) {
    const char = expression[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    }
  }
  return quote !== undefined;
}
