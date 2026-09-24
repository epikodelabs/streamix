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
