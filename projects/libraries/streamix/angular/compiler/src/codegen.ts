/** Indents every line of generated code. */
export function indent(
  source: string,
  spaces: number,
): string {
  if (!source) return '';

  const prefix = ' '.repeat(spaces);

  return source
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n');
}

/**
 * Embeds a template-derived string as a JavaScript string literal.
 *
 * `JSON.stringify` alone produces a valid literal, but leaves characters that
 * can break script contexts or defeat naive downstream filters when the
 * generated code is embedded verbatim: `<`, `>`, `/` (`</script>` breakout)
 * and the line separators U+2028/U+2029. Escaping them as `\u` sequences
 * preserves the identical runtime value.
 */
export function jsStringLiteral(value: string | undefined): string {
  // `undefined` names previously interpolated through JSON.stringify as the
  // bare identifier; generated code relies on that, so preserve it.
  if (value === undefined) return 'undefined';
  return JSON.stringify(value).replace(
    /[<>/\u2028\u2029]/g,
    char =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
