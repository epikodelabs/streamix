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

export function componentPathsInExpression(expression: string): readonly string[] {
  const paths: string[] = [];
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

    paths.push(match[0]);
  }

  return paths;
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
