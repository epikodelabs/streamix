export interface SxExpressionSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Returns Angular-evaluated expression contexts only: interpolation contents,
 * quoted property/directive/event binding values, and control-flow conditions
 * (including `@else if` and `@defer` triggers). Static attribute values and
 * prose are never returned, so recorded paths cannot leak into non-expression
 * text.
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

  for (const match of template.matchAll(/@(?:else\s+)?(?:if|switch|for|defer)\s*\(([\s\S]*?)\)/g)) {
    const openParen = match.index! + match[0].indexOf('(') + 1;
    push(openParen, match.index! + match[0].length - 1);
  }

  return spans;
}

/** A dotted-path read found in an expression, with its source offsets. */
export interface SxPathSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Locates every dotted-path read in an expression, ignoring string content. */
export function componentPathSpans(expression: string): readonly SxPathSpan[] {
  const spans: SxPathSpan[] = [];
  const pattern = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\b/g;

  for (const match of expression.matchAll(pattern)) {
    if (match.index == null || isInsideString(expression, match.index)) {
      continue;
    }

    // `$index`, `$count`, `$implicit`, … are Angular template variables. The
    // word boundary above starts the match after the `$`, so an unguarded read
    // would look like a component field named `count`.
    if (match.index > 0 && expression[match.index - 1] === '$') {
      continue;
    }

    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }

  return spans;
}

export function componentPathsInExpression(expression: string): readonly string[] {
  return componentPathSpans(expression).map(span => span.text);
}

/**
 * Locates dotted-path reads including `$`-prefixed template variables
 * (`$index`, `$count`). The rejection scanner deliberately ignores those, but
 * the compiled-block rewriter must resolve them against the loop context.
 */
export function localPathSpans(expression: string): readonly SxPathSpan[] {
  const spans: SxPathSpan[] = [];
  const pattern = /\$?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;

  for (const match of expression.matchAll(pattern)) {
    const start = match.index ?? 0;

    if (isInsideString(expression, start)) {
      continue;
    }

    // Skip identifiers that are part of a longer token, such as the
    // `sxReadLocal` inside an emitted `ɵsxReadLocal(...)` call.
    const previous = start > 0 ? expression[start - 1] : '';
    if (previous && /[A-Za-z0-9_$ɵ.]/.test(previous)) {
      continue;
    }

    spans.push({ start, end: start + match[0].length, text: match[0] });
  }

  return spans;
}

function isInsideString(expression: string, offset: number): boolean {
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
