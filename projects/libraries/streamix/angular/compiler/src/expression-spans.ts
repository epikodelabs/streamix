/** A dotted-path read found in an expression, with its source offsets. */
export interface SxPathSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
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
