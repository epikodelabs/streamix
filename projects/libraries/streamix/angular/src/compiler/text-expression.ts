export type SxTextExpressionMode =
  | 'direct'
  | 'expression'
  | 'hybrid';

export interface SxTextExpressionAnalysis {
  /** Expression between the interpolation braces. */
  readonly expression: string;
  /** Component paths whose `.value` reads make the expression reactive. */
  readonly dependencies: readonly string[];
  /** How the compiler should execute the interpolation. */
  readonly mode: SxTextExpressionMode;
  /** Present when the interpolation is exactly `<source>.value`. */
  readonly directSource?: string;
}

interface DependencyRead {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly text: string;
}

const SIMPLE_VALUE_READ =
  /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.value$/;

const VALUE_READ_AT_START =
  /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.value\b/;

const ALLOWED_BARE_IDENTIFIERS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'typeof',
  'void',
  // JavaScript globals that are also safe in Angular expressions and can be
  // evaluated directly by generated code without component-state tracking.
  'Math',
  'Number',
  'String',
  'Boolean',
  'BigInt',
  'Date',
  'JSON',
  'Array',
  'Object',
]);

/**
 * Recognizes a text interpolation that reads one or more Streamix `.value`
 * properties.
 *
 * Execution modes:
 *
 * - `direct`: exactly `<source>.value`; compiled as a normal `sx.text` binding.
 * - `expression`: every dynamic root is a Streamix `.value` read (plus safe
 *   literals/operators/globals); compiled to a direct multi-source text binding.
 * - `hybrid`: the expression mixes Streamix reads with ordinary Angular state
 *   or Angular-only expression features. Angular keeps the expression; the
 *   generated Streamix subscription only invalidates the owning Angular view.
 */
export function analyzeSxTextInterpolation(
  interpolationSource: string,
): SxTextExpressionAnalysis | undefined {
  const match = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(interpolationSource);
  const expression = match?.[1]?.trim();

  if (!expression) {
    return undefined;
  }

  const direct = SIMPLE_VALUE_READ.exec(expression);
  if (direct) {
    return {
      expression,
      dependencies: [direct[1]],
      directSource: direct[1],
      mode: 'direct',
    };
  }

  const reads = findDependencyReads(expression);
  if (reads.length === 0) {
    return undefined;
  }

  const dependencies: string[] = [];
  const seen = new Set<string>();

  for (const read of reads) {
    if (!seen.has(read.source)) {
      seen.add(read.source);
      dependencies.push(read.source);
    }
  }

  return {
    expression,
    dependencies,
    mode: isSupportedDirectExpression(expression, reads)
      ? 'expression'
      : 'hybrid',
  };
}

/** Extracts `<source>` from an exact `<source>.value` expression. */
export function extractDirectValueSource(
  expression: string,
): string | undefined {
  return SIMPLE_VALUE_READ.exec(expression.trim())?.[1];
}

/** Prefixes compiler-recognized Streamix reads with the component context. */
export function rewriteSxTextExpression(
  expression: string,
  contextName = 'ctx',
): string {
  const reads = findDependencyReads(expression);
  if (reads.length === 0) {
    return expression;
  }

  let rewritten = '';
  let cursor = 0;

  for (const read of reads) {
    rewritten += expression.slice(cursor, read.start);
    rewritten += `${contextName}.${read.text}`;
    cursor = read.end;
  }

  rewritten += expression.slice(cursor);
  return rewritten;
}

function findDependencyReads(expression: string): DependencyRead[] {
  const reads: DependencyRead[] = [];
  let quote: '"' | "'" | '`' | undefined;
  let escaped = false;

  for (let index = 0; index < expression.length;) {
    const char = expression[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      index += 1;
      continue;
    }

    if (isIdentifierStart(char) && !isPathContinuation(expression[index - 1])) {
      const match = VALUE_READ_AT_START.exec(expression.slice(index));
      if (match) {
        const text = match[0];
        const source = match[1];

        // A source path itself containing `.value.` is ambiguous: the first
        // `.value` could be ordinary object state rather than a Streamix read.
        if (!source.includes('.value.')) {
          reads.push({
            start: index,
            end: index + text.length,
            source,
            text,
          });
          index += text.length;
          continue;
        }
      }
    }

    index += 1;
  }

  return reads;
}

function isSupportedDirectExpression(
  expression: string,
  reads: readonly DependencyRead[],
): boolean {
  // Keep Angular-specific template-string semantics, pipes and mutation
  // expressions in Angular. Hybrid invalidation still makes their Streamix
  // reads reactive.
  if (expression.includes('`')) {
    return false;
  }

  const masked = maskStringsAndReads(expression, reads);

  // Angular pipes: logical OR (`||`) is fine; a solitary `|` is not.
  if (/(^|[^|])\|([^|]|$)/.test(masked)) {
    return false;
  }

  if (/(?:\+\+|--|(?<![=!<>])=(?!=)|\+=|-=|\*=|\/=|%=)/.test(masked)) {
    return false;
  }

  const identifier = /[A-Za-z_$][\w$]*/g;
  let match: RegExpExecArray | null;

  while ((match = identifier.exec(masked))) {
    const name = match[0];
    const start = match.index;

    if (/^__sx\d+$/.test(name) || ALLOWED_BARE_IDENTIFIERS.has(name)) {
      continue;
    }

    // Property/method names reached from a reactive value or allowed global
    // are not independent dependencies: `name.value.length`,
    // `Math.round(...)`, etc.
    let previous = start - 1;
    while (previous >= 0 && /\s/.test(masked[previous])) {
      previous -= 1;
    }

    if (masked[previous] === '.') {
      continue;
    }

    // Anything else is component state/method state that Streamix cannot know
    // has changed. Keep the expression Angular-owned and install invalidation.
    return false;
  }

  return true;
}

function maskStringsAndReads(
  expression: string,
  reads: readonly DependencyRead[],
): string {
  const chars = [...expression];
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];

    if (quote) {
      chars[index] = ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      chars[index] = ' ';
    }
  }

  let masked = chars.join('');

  // Replace from right to left so source offsets stay valid.
  [...reads].reverse().forEach((read, reverseIndex) => {
    const index = reads.length - reverseIndex - 1;
    const token = `__sx${index}`;
    masked =
      masked.slice(0, read.start) +
      token.padEnd(read.end - read.start, ' ') +
      masked.slice(read.end);
  });

  return masked;
}

function isIdentifierStart(char: string | undefined): boolean {
  return !!char && /[A-Za-z_$]/.test(char);
}

function isPathContinuation(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$.]/.test(char);
}
