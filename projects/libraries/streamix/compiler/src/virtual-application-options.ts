/** Remaps Angular application options shared by the Angular and React builders. */
export function virtualApplicationPathOverrides(
  configured: Record<string, unknown>,
  overrides: Record<string, unknown>,
  sourceRoot: string,
  virtualRoot: string,
  hasGeneratedFile: (path: string) => boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const prefix = sourceRoot.split(/[\\/]/).filter(Boolean).join('/') + '/';
  const destination = virtualRoot.replace(/\\/g, '/');
  const remap = (value: unknown, requireFile = false): unknown => {
    if (typeof value !== 'string' || /^(?:[\\/]|[A-Za-z]:)/.test(value)) return value;
    const parts: string[] = [];
    for (const part of value.split(/[\\/]/)) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) return value;
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    const path = parts.join('/');
    if (!path.startsWith(prefix)) return value;
    const generated = destination + '/' + path.slice(prefix.length);
    return !requireFile || hasGeneratedFile(generated) ? generated : value;
  };
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;

  const replacements = overrides['fileReplacements'] ?? configured['fileReplacements'];
  if (Array.isArray(replacements)) {
    result['fileReplacements'] = replacements.map(entry => {
      const replacement = asRecord(entry);
      return replacement
        ? { ...replacement, replace: remap(replacement['replace']), with: remap(replacement['with']) }
        : entry;
    });
  }
  const server = overrides['server'] ?? configured['server'];
  const generatedServer = remap(server, true);
  if (generatedServer !== server) result['server'] = generatedServer;

  for (const [key, field] of [['ssr', 'entry'], ['prerender', 'routesFile']]) {
    const override = overrides[key];
    const configuredValue = asRecord(configured[key]);
    const effective = override === undefined ? configuredValue
      : asRecord(override) && { ...configuredValue, ...asRecord(override) };
    if (!effective) continue;
    const generated = remap(effective[field], true);
    if (generated !== effective[field]) result[key] = { ...effective, [field]: generated };
  }
  return result;
}
